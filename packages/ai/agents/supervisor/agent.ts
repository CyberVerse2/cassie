import { ToolLoopAgent, type TelemetryIntegration } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  DEFAULT_IMPORTANT_MODEL,
  GoogleImportantStructuredClient,
  DirectDeepSeekStructuredClient,
} from "../../client.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../../../execution/account-state.ts";
import { CompositeMarketDataProvider, PolymarketMarketDataProvider } from "../../../market-data/index.ts";
import { LiveResearchSearchLanes } from "../../../research/lanes.ts";
import { DrizzleCassieStore } from "../../../db/drizzle-store.ts";
import type { CassieStore } from "../../../db/store.ts";
import type { ControlRun } from "../../../core/schemas/index.ts";
import { SupervisorFinalResultSchema } from "../../../core/schemas/index.ts";
import { formatErrorForLog } from "../../../core/error-format.ts";
import type { CassieDependencies } from "../../../workflows/dependencies.ts";
import { createCassieSupervisorTools, finalizeRunFromPersistedSteps } from "./tools.ts";
import {
  createCassieStopConditions,
  prepareCassieSupervisorStep,
} from "./policy.ts";
import { googleThinkingOptions } from "../../google-options.ts";
import { configureAiSdkWarningLogging } from "../../sdk-warnings.ts";

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
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
    const agent = new ToolLoopAgent({
      id: "cassie-supervisor",
      model: google(process.env.CASSIE_IMPORTANT_MODEL ?? DEFAULT_IMPORTANT_MODEL),
      providerOptions: googleThinkingOptions("low"),
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
        totalMs: Number(process.env.CASSIE_SUPERVISOR_TIMEOUT_MS ?? 1_800_000),
        stepMs: Number(process.env.CASSIE_SUPERVISOR_STEP_TIMEOUT_MS ?? 900_000),
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
  const cheapAi = new DirectDeepSeekStructuredClient();
  const importantAi = new GoogleImportantStructuredClient();
  return {
    ai: cheapAi,
    cheapAi,
    importantAi,
    marketData: new CompositeMarketDataProvider(),
    polymarketMarketFinder: new PolymarketMarketDataProvider(),
    researchLanes: new LiveResearchSearchLanes(),
  };
}

export function buildSupervisorInstructions(): string {
  return `You are Cassie's supervisor agent.

Use the available tools as a flexible governed loop. You may choose tools dynamically, revisit analysis, branch into research, inspect markets, critique the thesis, or finalize when the best grounded result is clear.

Safety and behavior:
- Do not ask the user follow-up questions mid-run.
- Treat ambiguity conservatively and explain the conservative choice in the final result.
- Do not execute orders, place orders, or enqueue execution.
- A trade ticket is only a proposed/actionable ticket, not an executed trade.
- Never invent market candidates, prices, account state, or risk approvals.
- Ground every decision and summary in tool outputs.
- If risk_check rejects a proposal, finalize with analysis and the rejection reason; do not present the trade as approved.
- Watchlist behavior is valid only for explicit watch requests.
- Do not silently replace AI classification, routing, ranking, matching, or selection with keyword heuristics.

Tool-use guidance:
- Use research and critique tools when the claim needs evidence before a market decision.
- Use market tools only for real market discovery or selection.
- Use risk_check only after a real selected market exists.
- Use create_trade_ticket only after a non-rejected risk_check.
- Finalize with analysis or critique when evidence, market fit, or risk does not justify a ticket.

Mode policy:
- trade: classify intent, interpret signal, extract thesis, research the thesis, plan the trade expression, inspect/select real markets when needed, run risk before any ticket, and finalize no-trade or insufficient-evidence analysis when evidence, market fit, or risk does not clear.
- critic: classify intent, interpret signal, extract thesis, research the thesis, critique the researched thesis, and finalize with a direct critique or analysis. Do not create a ticket for critic-only requests.
- countertrade: classify intent, interpret signal, extract the original thesis, extract the inverse thesis, research the basis and counter-case, plan the clean inverse expression if one exists, and require market/risk gates before any ticket.
- watch: classify intent, interpret signal, extract thesis, research enough to define what should be watched, plan the relevant expression or trigger, and finalize with a watchlist-style analysis. Do not create a ticket for watch-only requests.

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
  return name.includes("/") ? name.split("/")[0] ?? "unknown" : "openai";
}
