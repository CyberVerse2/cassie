import { RunStepTypeSchema, type RunStep, type RunStepType } from "../../../core/schemas/index.ts";
import type { CassieStore } from "../../../db/store.ts";
import { formatErrorForLog } from "../../../core/error-format.ts";

export async function recordRunStep<T>(input: {
  store: CassieStore;
  runId: string;
  stepType: RunStepType;
  promptName?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  stepInput: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
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
  });

  try {
    const output = await input.execute();
    await input.store.updateRunStep({
      ...started,
      status: "succeeded",
      output,
      completedAt: new Date().toISOString(),
    });
    return output;
  } catch (error) {
    await input.store.updateRunStep({
      ...started,
      status: "failed",
      error: formatErrorForLog(error),
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export function isStepType(value: string): value is RunStep["stepType"] {
  return RunStepTypeSchema.safeParse(value).success;
}
