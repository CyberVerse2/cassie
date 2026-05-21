import { Output, ToolLoopAgent, type TelemetryIntegration } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  OpenAiImportantStructuredClient,
  DirectDeepSeekStructuredClient,
} from "../../client.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../../../execution/account-state.ts";
import { CompositeMarketDataProvider } from "../../../market-data/index.ts";
import { LiveResearchSearchLanes } from "../../../research/lanes.ts";
import { DrizzleCassieStore } from "../../../db/drizzle-store.ts";
import type { CassieStore } from "../../../db/store.ts";
import type { ControlRun } from "../../../core/schemas/index.ts";
import { SupervisorFinalResultSchema } from "../../../core/schemas/index.ts";
import type { CassieDependencies } from "../../../workflows/dependencies.ts";
import { createCassieSupervisorTools } from "./tools.ts";
import {
  createCassieStopConditions,
  prepareCassieSupervisorStep,
} from "./policy.ts";
import { openAiCostControlOptions } from "../../openai-options.ts";

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
    const agent = new ToolLoopAgent({
      id: "cassie-supervisor",
      model: openai(process.env.CASSIE_IMPORTANT_MODEL ?? "gpt-5.5"),
      providerOptions: openAiCostControlOptions({ promptCacheKey: "cassie-supervisor" }),
      stopWhen: createCassieStopConditions(),
      tools,
      output: Output.object({
        schema: SupervisorFinalResultSchema,
        name: "cassie_supervisor_final_result",
      }),
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
        totalMs: Number(process.env.CASSIE_SUPERVISOR_TIMEOUT_MS ?? 900_000),
        stepMs: Number(process.env.CASSIE_SUPERVISOR_STEP_TIMEOUT_MS ?? 300_000),
      },
    });

    const completed = await store.getRun(running.runId);
    if (completed?.status === "running") {
      await store.updateRun({
        ...completed,
        status: "succeeded",
        result: result.output,
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
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function defaultDependencies(): CassieDependencies {
  const cheapAi = new DirectDeepSeekStructuredClient();
  const importantAi = new OpenAiImportantStructuredClient();
  return {
    ai: cheapAi,
    cheapAi,
    importantAi,
    marketData: new CompositeMarketDataProvider(),
    researchLanes: new LiveResearchSearchLanes(),
  };
}

function buildSupervisorInstructions(): string {
  return `You are Cassie's supervisor agent.

Use the available tools to process this run. Do not execute orders. Create a trade ticket only when the user asks for trading or countertrading and risk does not reject the proposal.

Required behavior:
- Start with classify_intent, interpret_signal, and extract_thesis.
- For critic requests, call research_thesis, critique_thesis, then finalize_run.
- For trade requests, call research_thesis, select_market, risk_check, create_trade_ticket when allowed, then finalize_run.
- For countertrade requests, call extract_inverse_thesis before research and market selection.
- For think requests, call select_market and risk_check, then finalize_run without creating a ticket.
- If risk_check rejects, do not call create_trade_ticket. Finalize with analysis and the rejection reason.
- Always call finalize_run exactly once after the required tools have completed.
- final_result.publicSummary must be concise, user-facing, and grounded in tool outputs.
- After finalize_run succeeds, produce the final structured supervisor output. Match it to the finalize_run result and do not call more tools.
- Never invent market candidates.
- Never place orders or enqueue execution.`;
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
  return error instanceof Error ? error.message : String(error);
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
