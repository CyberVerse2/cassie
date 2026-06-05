import { ToolLoopAgent, type TelemetryIntegration } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  CassieStructuredClient,
  extractModelThinkingTrace,
  providerOptionsForRoute,
  type StructuredAiClient,
} from "../ai/client.ts";
import { CompositeMarketDataProvider } from "../adapters/index.ts";
import {
  PolymarketMarketDataProvider,
} from "../adapters/index.ts";
import {
  AiPolymarketDiscoveryQueryPlanner,
  AiPolymarketSearchResultSelector,
  type MarketDataProvider,
  type PolymarketMarketFinder,
} from "../adapters/selection.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { ControlRun } from "../core/schemas/index.ts";
import { SupervisorFinalResultSchema } from "../core/schemas/index.ts";
import { formatErrorForLog } from "../core/helpers/error-format.ts";
import { createCassieSupervisorTools, finalizeRunFromPersistedSteps } from "./tools.ts";
import { GrokXSourceResolver, type SourceResolver } from "./source.ts";
import {
  createCassieStopConditions,
  prepareCassieSupervisorStep,
} from "./policy.ts";
import { configureAiSdkWarningLogging } from "../ai/helpers/sdk-warnings.ts";
import { config } from "../core/config.ts";

configureAiSdkWarningLogging();

export interface CassieDependencies {
  ai?: StructuredAiClient;
  cheapAi?: StructuredAiClient;
  importantAi?: StructuredAiClient;
  marketData: MarketDataProvider;
  polymarketMarketFinder?: PolymarketMarketFinder;
  sourceResolver?: SourceResolver;
}

export async function runCassieSupervisorForRun(input: {
  runId: string;
  store?: CassieStore;
  deps?: CassieDependencies;
}) {
  const store = input.store ?? new DrizzleCassieStore();
  const run = await store.getRun(input.runId);
  if (!run) throw new Error(`Run ${input.runId} was not found.`);

  const userSettings = await store.getUserSettings(run.userId);
  if (!userSettings) throw new Error(`No Cassie settings found for user ${run.userId}.`);

  const running = {
    ...run,
    status: "running" as const,
    error: null,
    updatedAt: new Date().toISOString(),
  };
  await store.updateRun(running);

  try {
    const deps = input.deps ?? defaultDependencies();
    const tools = createCassieSupervisorTools({
      store,
      deps,
      run: running,
      userSettings,
    });
    const openai = createOpenAI({
      apiKey: config.ai.openAiApiKey,
    });
    const agent = new ToolLoopAgent({
      id: "cassie-supervisor",
      model: openai(config.ai.importantModel),
      providerOptions: providerOptionsForRoute({
        provider: "openai",
        tier: "expensive",
        model: config.ai.importantModel,
      }),
      stopWhen: createCassieStopConditions(),
      tools,
      prepareStep: prepareCassieSupervisorStep,
      onStepFinish: async (step) => {
        const usage = usageRecord(step.usage);
        await store.addModelCallUsage({
          controlRunId: running.runId,
          runStepId: null,
          purpose: "supervisor_step",
          provider: providerFromModel(step.model),
          model: modelName(step.model),
          promptName: "cassie_supervisor",
          promptVersion: "2026-05-20",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedTokens: usage.cachedTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: null,
          latencyMs: null,
          thinkingTrace: extractModelThinkingTrace(step),
          status: "succeeded",
          error: null,
        });
        await store.audit({
          entityId: running.runId,
          entityType: "run",
          eventType: "agent.step.finished",
          message: "Cassie supervisor step finished.",
          data: {
            runId: running.runId,
            stepNumber: step.stepNumber,
            model: step.model,
            finishReason: step.finishReason,
            usage: step.usage,
            toolCalls: step.toolCalls.map((call) => call.toolName),
          },
        });
      },
      onFinish: async (event) => {
        await store.audit({
          entityId: running.runId,
          entityType: "run",
          eventType: "agent.finished",
          message: "Cassie supervisor finished.",
          data: {
            runId: running.runId,
            finishReason: event.finishReason,
            totalUsage: event.totalUsage,
            steps: event.steps.length,
          },
        });
      },
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
        functionId: "cassie-supervisor",
        metadata: { runId: running.runId, userId: running.userId },
        integrations: createAuditTelemetryIntegration(store, running),
      },
      instructions: buildSupervisorInstructions(),
    });
    const result = await agent.generate({
      prompt: buildSupervisorPrompt(running),
      timeout: {
        totalMs: config.supervisor.timeoutMs,
        stepMs: config.supervisor.stepTimeoutMs,
      },
    });
    const finalResult = extractFinalizeRunOutput(result)
      ?? await finalizeRunFromPersistedSteps({ store, run: running });

    const completed = await store.getRun(running.runId);
    if (completed?.status === "running") {
      await store.updateRun({
        ...completed,
        status: "succeeded",
        result: finalResult,
        error: null,
        updatedAt: new Date().toISOString(),
      });
    }

    return result;
  } catch (error) {
    const latest = await store.getRun(running.runId);
    await store.updateRun({
      ...(latest ?? running),
      status: "failed",
      error: formatErrorForLog(error),
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function extractFinalizeRunOutput(result: { toolResults: unknown[]; steps: Array<{ toolResults: unknown[] }> }) {
  const toolResults = [
    ...result.steps.flatMap((step) => step.toolResults),
    ...result.toolResults,
  ];
  const finalizeResult = toolResults
    .map((toolResult) => objectRecord(toolResult))
    .filter((toolResult) => toolResult.toolName === "finalize_run")
    .at(-1);
  const output = finalizeResult?.output;
  return output == null ? null : SupervisorFinalResultSchema.parse(output);
}

function defaultDependencies(): CassieDependencies {
  const ai = new CassieStructuredClient();
  return {
    ai,
    cheapAi: ai,
    importantAi: ai,
    marketData: new CompositeMarketDataProvider(),
    sourceResolver: new GrokXSourceResolver(),
    polymarketMarketFinder: new PolymarketMarketDataProvider(
      undefined,
      new AiPolymarketDiscoveryQueryPlanner(ai),
      new AiPolymarketSearchResultSelector(ai),
    ),
  };
}

export function buildSupervisorInstructions(): string {
  return [
    "You are Cassie's governed supervisor for tagged-tweet trade research.",
    "",
    "Required staged architecture:",
    "preflight user policy -> classify source mode -> resolve source if needed -> frame opportunity -> generate candidate trade expressions -> search real venues -> assess expression fit -> quote validated candidates -> rank expressions -> create trade ticket when intent allows -> finalize run.",
    "",
    "Role:",
    "Coordinate typed tools through the governed sequence. Do not replace AI-backed semantic judgments with keyword scoring, hardcoded routing, or ad hoc shortcuts.",
    "",
    "Progressive workflow:",
    "1. Establish whether the user is allowed to receive a trade workflow.",
    "2. Classify source mode and resolve source identity when needed.",
    "3. Frame the opportunity before choosing expression rails.",
    "4. Generate abstract candidateExpressions before venue search.",
    "5. Search only configured venues for expressions that need discovery.",
    "6. Assess fit before quote, quote before rank, rank before ticket.",
    "7. Finalize with the evidence-supported outcome.",
    "",
    "Stage gates:",
    "- Run preflight_user_policy and classify_source_mode before semantic opportunity analysis.",
    "- Resolve the source before frame_opportunity when the run only has an X/Twitter status URL.",
    "- Do not search venues until generate_trade_expressions has produced candidateExpressions that need configured venue discovery.",
    "- Do not quote or rank a venue candidate until assess_expression_fit validates it or identifies exactly what information is still required.",
    "- If a required stage cannot produce evidence, finalize with the explicit missing evidence or venue failure; do not silently substitute a different rail.",
    "",
    "When uncertain:",
    "- Surface missing source evidence, venue failures, rule gaps, quote gaps, or fit uncertainty in the final result.",
    "- Do not silently reroute to a different rail because a required market, quote, or rule is unavailable.",
    "",
    "Classify breaking_news from source content only. Do not use urgency words in the user command to set source mode. Use the user command only to preserve userIntent: trade, watch, countertrade, or critic.",
    "",
    "Breaking news is a routing mode, not an execution decision. In breaking-news mode, reduce serial deliberation: identify the headline thesis, generate direct and downstream expressions, search configured venues quickly, and route only validated expressions. For watch, countertrade, and critic intents, do not create a trade ticket; finalize with the appropriate analysis unless the preserved userIntent is trade.",
    "",
    "Do not route directly to Polymarket, crypto, or pre-IPO before framing the opportunity. First identify the market opportunity, then let candidate expression generation decide which expression rails deserve venue search.",
    "",
    "Use the AI-backed semantic tools for opportunity framing, trade-expression generation, expression-fit assessment, and expression ranking. Do not replace those judgments with keyword scoring, regex matching, hardcoded lookup tables, or term-overlap heuristics.",
    "",
    "Never invent tickers, markets, prices, liquidity, probabilities, listings, or contract rules. Venue tools may only return real configured venue candidates. If no real market validates the thesis, finalize no-trade, watchlist, or analysis-only.",
    "",
    "After ranking a real validated candidate for trade intent, create_trade_ticket creates the ticket with the user's configured default trade size and an explicit exitPlan chosen by the agent. The exitPlan must include takeProfitPct, stopLossPct, maxHoldDays, daily review cadence, thesis, and concrete invalidationSignals. The execution worker handles order submission after ticket creation.",
    "",
    "Before finalizing, verify internally that the run has the staged evidence required for its outcome: preflight decision, source mode, source resolution when needed, opportunity frame, expression plan, venue search or no-search reason, fit assessment, quote when selecting a market, ranking when selecting a market, and ticket only when preserved userIntent allows trading.",
    "",
    "Finalize every run with finalize_run after enough staged evidence exists for trade_ticket, no_trade, watchlist-style analysis, or analysis-only.",
  ].join("\n");
}

function buildSupervisorPrompt(run: ControlRun): string {
  return [
    "Analyze this tagged tweet through the staged architecture. Resolve the source first when the run only contains an X/Twitter status URL; otherwise use the provided SourcePost for frame_opportunity.",
    "",
    `Run ID: ${run.runId}`,
    `User command: ${run.userCommand}`,
    "Source post:",
    JSON.stringify({
      text: run.sourcePost.text,
      url: run.sourcePost.url,
      author: run.sourcePost.authorHandle,
    }, null, 2),
  ].join("\n");
}

function createAuditTelemetryIntegration(
  store: CassieStore,
  run: ControlRun,
): TelemetryIntegration {
  return {
    onToolCallFinish: async (event) => {
      await store.audit({
        entityId: run.runId,
        entityType: "run",
        eventType: event.success ? "agent.tool.finished" : "agent.tool.failed",
        message: event.success ? "Cassie supervisor tool finished." : "Cassie supervisor tool failed.",
        data: {
          runId: run.runId,
          stepNumber: event.stepNumber,
          toolName: event.toolCall.toolName,
          durationMs: event.durationMs,
          success: event.success,
          error: event.success ? null : formatErrorForLog(event.error),
        },
      });
    },
  };
}

function usageRecord(usage: unknown) {
  const record = objectRecord(usage);
  const outputDetails = objectRecord(record.outputTokenDetails);
  const inputDetails = objectRecord(record.inputTokenDetails);
  return {
    inputTokens: numberOrNull(record.inputTokens),
    outputTokens: numberOrNull(record.outputTokens),
    reasoningTokens: numberOrNull(outputDetails.reasoningTokens),
    cachedTokens: numberOrNull(inputDetails.cacheReadTokens),
    totalTokens: numberOrNull(record.totalTokens),
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function modelName(model: unknown): string {
  if (typeof model === "string") return model;
  const record = objectRecord(model);
  if (typeof record.modelId === "string") return record.modelId;
  if (typeof record.id === "string") return record.id;
  return String(model ?? "unknown");
}

function providerFromModel(model: unknown): string {
  const name = modelName(model);
  if (name.startsWith("deepseek-")) return "deepseek";
  if (name.startsWith("gemini-")) return "google";
  return name.includes("/") ? name.split("/")[0] ?? "unknown" : "openai";
}
