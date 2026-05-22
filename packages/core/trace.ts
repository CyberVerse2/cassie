import { formatErrorForLog } from "./error-format.ts";

export type TraceStatus = "running" | "succeeded" | "failed";

export type TraceUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
};

export type TraceEvent = {
  stepId: number;
  name: string;
  kind: "ai" | "tool" | "connector" | "workflow";
  status: TraceStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  model: string | null;
  thinkingTrace: string;
  input: unknown;
  output: unknown;
  usage: TraceUsage | null;
  error: string | null;
};

export class TraceRecorder {
  private nextId = 1;
  private readonly events: TraceEvent[] = [];

  constructor(private readonly onEvent?: (event: TraceEvent) => void) {}

  start(input: {
    name: string;
    kind: TraceEvent["kind"];
    model?: string | null;
    thinkingTrace: string;
    input?: unknown;
  }): (output: { output?: unknown; usage?: unknown; error?: unknown }) => void {
    const startedAt = new Date();
    const event: TraceEvent = {
      stepId: this.nextId,
      name: input.name,
      kind: input.kind,
      status: "running",
      startedAt: startedAt.toISOString(),
      completedAt: null,
      durationMs: null,
      model: input.model ?? null,
      thinkingTrace: input.thinkingTrace,
      input: input.input ?? null,
      output: null,
      usage: null,
      error: null,
    };
    this.nextId += 1;
    this.events.push(event);
    this.onEvent?.({ ...event });

    return (output) => {
      const completedAt = new Date();
      event.completedAt = completedAt.toISOString();
      event.durationMs = completedAt.getTime() - startedAt.getTime();
      event.status = output.error ? "failed" : "succeeded";
      event.output = output.output ?? null;
      event.usage = output.usage ? normalizeUsage(output.usage) : null;
      event.error = output.error ? formatErrorForLog(output.error) : null;
      this.onEvent?.({ ...event });
    };
  }

  snapshot(): TraceEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  usageTotals(): TraceUsage {
    return this.events.reduce<TraceUsage>(
      (total, event) => addUsage(total, event.usage),
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
      },
    );
  }
}

function normalizeUsage(usage: unknown): TraceUsage {
  if (!usage || typeof usage !== "object") {
    return emptyUsage();
  }

  const record = usage as Record<string, unknown>;
  const outputDetails = objectRecord(record.outputTokenDetails);
  const inputDetails = objectRecord(record.inputTokenDetails);

  return {
    inputTokens: numberOrNull(record.inputTokens),
    outputTokens: numberOrNull(record.outputTokens),
    totalTokens: numberOrNull(record.totalTokens),
    reasoningTokens: numberOrNull(outputDetails.reasoningTokens),
    cacheReadTokens: numberOrNull(inputDetails.cacheReadTokens),
  };
}

function addUsage(left: TraceUsage, right: TraceUsage | null): TraceUsage {
  if (!right) {
    return left;
  }

  return {
    inputTokens: addNullable(left.inputTokens, right.inputTokens),
    outputTokens: addNullable(left.outputTokens, right.outputTokens),
    totalTokens: addNullable(left.totalTokens, right.totalTokens),
    reasoningTokens: addNullable(left.reasoningTokens, right.reasoningTokens),
    cacheReadTokens: addNullable(left.cacheReadTokens, right.cacheReadTokens),
  };
}

function emptyUsage(): TraceUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left == null && right == null) {
    return null;
  }

  return (left ?? 0) + (right ?? 0);
}
