import type { RunStepType } from "../core/schemas/index.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { StructuredAiClient } from "../ai/client.ts";
import { withUsageCapture } from "../ai/client.ts";
import { formatErrorForLog } from "../core/helpers/error-format.ts";

export type RunStepExecutionContext = {
  setThinkingTrace: (thinkingTrace: string | null) => void;
  captureUsage: (ai: StructuredAiClient) => StructuredAiClient;
};

export async function recordRunStep<T>(input: {
  store: CassieStore;
  runId: string;
  stepType: RunStepType;
  promptName?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  thinkingTrace?: string | null;
  stepInput: unknown;
  execute: (context: RunStepExecutionContext) => Promise<T>;
}): Promise<T> {
  let thinkingTrace = input.thinkingTrace ?? null;
  const started = await input.store.addRunStep({
    runId: input.runId,
    stepType: input.stepType,
    status: "running",
    input: input.stepInput,
    output: null,
    error: null,
    model: input.model ?? null,
    promptName: input.promptName ?? null,
    promptVersion: input.promptVersion ?? null,
    thinkingTrace,
  });

  try {
    const output = await input.execute({
      setThinkingTrace: (value) => {
        thinkingTrace = value;
      },
      captureUsage: (ai) =>
        withUsageCapture(ai, async (usage) => {
          await input.store.addModelCallUsage({
            controlRunId: input.runId,
            runStepId: started.stepId,
            purpose: input.stepType,
            provider: usage.provider,
            model: usage.model,
            promptName: input.promptName ?? null,
            promptVersion: input.promptVersion ?? null,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
            cachedTokens: usage.cachedTokens,
            totalTokens: usage.totalTokens,
            estimatedCostUsd: null,
            latencyMs: null,
            thinkingTrace,
            status: "succeeded",
            error: null,
          });
        }),
    });
    await input.store.updateRunStep({
      ...started,
      status: "succeeded",
      output,
      thinkingTrace,
      completedAt: new Date().toISOString(),
    });
    return output;
  } catch (error) {
    await input.store.updateRunStep({
      ...started,
      status: "failed",
      error: formatErrorForLog(error),
      thinkingTrace,
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}
