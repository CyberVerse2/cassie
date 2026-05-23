import { ToolLoopAgent, type TelemetryIntegration } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { CassieStructuredClient } from "../../ai/client.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../../execution/account-state.ts";
import { CompositeMarketDataProvider, PolymarketMarketDataProvider } from "../../markets/index.ts";
import { DrizzleCassieStore } from "../../core/db/drizzle-store.ts";
import type { CassieStore } from "../../core/db/store.ts";
import type { ControlRun } from "../../core/schemas/index.ts";
import { SupervisorFinalResultSchema } from "../../core/schemas/index.ts";
import { formatErrorForLog } from "../../core/error-format.ts";
import type { CassieDependencies } from "../../app/dependencies.ts";
import { AiPolymarketDiscoveryQueryPlanner } from "../tools/market.ts";
import { createCassieSupervisorTools, finalizeRunFromPersistedSteps } from "./tools.ts";
import {
  createCassieStopConditions,
  prepareCassieSupervisorStep,
} from "./policy.ts";
import { configureAiSdkWarningLogging } from "../../ai/sdk-warnings.ts";
import { config } from "../../core/config.ts";

configureAiSdkWarningLogging();

export async function runCassieSupervisorForRun(input: {
  runId: string;
  store?: CassieStore;
  deps?: CassieDependencies;
  accountStateProvider?: AccountStateProvider;
}) {
  const store = input.store ?? new DrizzleCassieStore();
  const run = await store.getRun(input.runId);
  if (!run) throw new Error(`Run ${input.runId} was not found.`);

  const userSettings = await store.getUserSettings(run.userId);
  if (!userSettings) throw new Error(`No Cassie settings found for user ${run.userId}.`);

  const running = {
    ...run,
    status: "running" as const,
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
      accountStateProvider: input.accountStateProvider ?? new HyperliquidAccountStateProvider(),
    });
    const deepseek = createDeepSeek({
      apiKey: config.ai.deepSeekApiKey,
    });
    const agent = new ToolLoopAgent({
      id: "cassie-supervisor",
      model: deepseek.chat(config.ai.importantModel),
      stopWhen: createCassieStopConditions(),
      tools,
      prepareStep: prepareCassieSupervisorStep,
      onStepFinish: async (step) => {
        const usage = usageRecord(step.usage);
        await store.addModelCallUsage({
          controlRunId: running.runId,
          researchRunId: null,
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
    polymarketMarketFinder: new PolymarketMarketDataProvider(
      "https://gamma-api.polymarket.com/markets",
      "https://clob.polymarket.com",
      new AiPolymarketDiscoveryQueryPlanner(ai),
    ),
  };
}

export function buildSupervisorInstructions(): string {
  return `You are Cassie's supervisor agent.

Use the available tools as one flexible governed loop. You may choose tools dynamically. Treat the user's command as execution intent. Translate the source post as a raw verifiable signal into competing trade expressions, search real venues, rank the cleanest expression, apply risk gates, create a ticket when allowed, or finalize when no clean ticket can be created.

Safety and behavior:
- Do not ask the user follow-up questions mid-run.
- Treat ambiguity conservatively and explain the conservative choice in the final result.
- Do not execute orders, place orders, or enqueue execution.
- A trade ticket is only a proposed/actionable ticket, not an executed trade.
- Never invent market candidates, prices, account state, or risk approvals.
- Ground every decision and summary in the source post and tool outputs.
- If risk_check rejects a proposal, finalize with analysis and the rejection reason; do not present the trade as approved.
- Do not silently replace AI classification, routing, ranking, matching, or selection with keyword heuristics.
- Treat signal verification as an input into expression quality, expected edge, sizing readiness, or no-trade. Do not make verification the mandatory front door unless it changes the tradable expression.
- Do not call tools that run hidden AI tool loops. The supervisor owns the whole tool history.

Tool-use guidance:
- Start with frame_opportunity.
- Use generate_trade_expressions to create competing expression families from the framed opportunity.
- Use search_venues to find real supported venue candidates before ranking when venue availability is not already grounded.
- Use assess_expression_fit and quote_expression for promising candidates when semantics, side, liquidity, spread, or price need to be refreshed.
- Use rank_expressions to choose the best grounded expression from real candidates.
- Use risk_check only after a real selected market exists.
- Use create_trade_ticket only after a non-rejected risk_check.
- Once you have made the grounded decision for this run, call finalize_run next instead of continuing to call exploratory tools.
- Finalize with analysis when market fit, venue availability, or risk does not justify a ticket.

Mode policy:
- trade: frame the opportunity, generate expressions, search/rank real markets when needed, run risk before any ticket, and finalize no-trade analysis when market fit, venue availability, or risk does not clear.
- critic: frame the opportunity and use generate_trade_expressions to explain the setup, market fit, and weaknesses from the source context, then finalize with analysis. Do not create a ticket for critic-only requests.
- countertrade: frame the opportunity, generate the clean inverse or fade expression from the user command and source post, then require venue and risk gates before any ticket.
- watch: frame the opportunity, identify the relevant expression or trigger, then finalize with a watch-style analysis. Do not create a ticket for watch-only requests.

Final response requirements:
- Always use finalize_run for the final result.
- finalize_run.publicSummary must be concise, user-facing, and written like Cassie is answering the user.
- State the verdict, the reason, and the next action in plain market language.
- Do not copy enum values, tool names, step names, scores, or timeline-style labels into the summary.`;
}

function buildSupervisorPrompt(run: ControlRun): string {
  return `Process this Cassie run.

Run:
${JSON.stringify({
  runId: run.runId,
  userCommand: run.userCommand,
  sourcePost: run.sourcePost,
}, null, 2)}`;
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
          error: event.success ? null : errorMessage(event.error),
        },
      });
    },
  };
}

function errorMessage(error: unknown): string {
  return formatErrorForLog(error);
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
