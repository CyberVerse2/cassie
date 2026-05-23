import type { RunStepType } from "../core/schemas/index.ts";

export function createRunStepCache() {
  const stepOutputs = new Map<string, Promise<unknown>>();

  return {
    runStepOnce<T>(stepType: RunStepType, input: unknown, execute: () => Promise<T>): Promise<T> {
      const cacheKey = `${stepType}:${stableStringify(input)}`;
      const existing = stepOutputs.get(cacheKey);
      if (existing) return existing as Promise<T>;

      const promise = execute().catch((error) => {
        stepOutputs.delete(cacheKey);
        throw error;
      });
      stepOutputs.set(cacheKey, promise);
      return promise;
    },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortForStableStringify(entry)]),
  );
}
