import { ToolLoopAgent, type TelemetryIntegration } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  CassieStructuredClient,
  extractModelThinkingTrace,
  providerOptionsForRoute,
  type StructuredAiClient,
} from "../ai/client.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../adapters/hyperliquid/account-state.ts";
import { CompositeMarketDataProvider } from "../adapters/index.ts";
import {
  AiPolymarketDiscoveryQueryPlanner,
  PolymarketMarketDataProvider,
  type MarketDataProvider,
  type PolymarketMarketFinder,
} from "../adapters/polymarket/index.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { ControlRun } from "../core/schemas/index.ts";
import { SupervisorFinalResultSchema } from "../core/schemas/index.ts";
import { formatErrorForLog } from "../core/helpers/index.ts";
import { createCassieSupervisorTools, finalizeRunFromPersistedSteps } from "./tools.ts";
import { GrokXSourceResolver, type SourceResolver } from "./source.ts";
import {
  createCassieStopConditions,
  prepareCassieSupervisorStep,
} from "./policy.ts";
import { configureAiSdkWarningLogging } from "../ai/helpers/index.ts";
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
      accountStateProvider: input.accountStateProvider ?? new HyperliquidAccountStateProvider(),
    });
    const openai = createOpenAI({
      apiKey: config.ai.openAiApiKey,
    });
    const agent = new ToolLoopAgent({
      id: "cassie-supervisor",
      model: openai.chat(config.ai.importantModel),
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
      "https://gamma-api.polymarket.com/markets",
      "https://clob.polymarket.com",
      new AiPolymarketDiscoveryQueryPlanner(ai),
    ),
  };
}

export function buildSupervisorInstructions(): string {
  return [
    "You are Cassie's governed supervisor for tagged-tweet trade research.",
    "",
    "Required staged architecture:",
    "resolve source -> frame opportunity -> generate candidate trade expressions -> search real venues -> assess expression fit -> quote validated candidates -> rank expressions -> risk check -> create trade ticket -> finalize run.",
    "",
    "If the run only contains a mention or command with an X/Twitter status URL, call resolve_source first and pass the resolved SourcePost into frame_opportunity.",
    "",
    "Do not route directly to Polymarket, crypto, or pre-IPO before framing the opportunity. First identify the market opportunity, then let candidate expression generation decide which expression rails deserve venue search.",
    "",
    "Use the AI-backed semantic tools for opportunity framing, trade-expression generation, expression-fit assessment, and expression ranking. Do not replace those judgments with keyword scoring, regex matching, hardcoded lookup tables, or term-overlap heuristics.",
    "",
    "Never invent tickers, markets, prices, liquidity, probabilities, listings, or contract rules. Venue tools may only return real configured venue candidates. If no real market validates the thesis, finalize no-trade, watchlist, or analysis-only.",
    "",
    "Use deterministic risk checks only after ranking a real validated candidate. Never execute an order; create_trade_ticket only creates a ticket for the configured approval flow.",
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
    JSON.stringify(run.sourcePost, null, 2),
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
