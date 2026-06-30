import type { TraceEvent, TraceUsage } from "../packages/core/trace.ts";

type VisibilityInput = {
  result: unknown;
  trace: TraceEvent[];
  tokenUsage: TraceUsage;
};

type RecordValue = Record<string, unknown>;

export function buildVisibilityReport(input: VisibilityInput) {
  const run = extractRun(input.result);
  const tradeExpression = findTradeExpression(run, input.trace);

  return {
    decisionLedger: {
      responseType: stringField(run, "responseType"),
      actionState: stringField(run, "actionState"),
      tradeDecision: stringField(tradeExpression, "decision"),
      tradeReason: stringField(tradeExpression, "reason"),
      marketRouted: Boolean(hasField(run, "marketSelection")),
      ticketCreated: Boolean(
        hasField(run, "tradeTicket") || hasField(run, "ticketId"),
      ),
    },
    tradeExpression: tradeExpression
      ? {
          signal: stringField(tradeExpression, "signal"),
          coreInterpretation: stringField(
            tradeExpression,
            "coreInterpretation",
          ),
          directAsset: nullableStringField(tradeExpression, "directAsset"),
          directAssetTradable: booleanField(
            tradeExpression,
            "directAssetTradable",
          ),
          highestPurityExpression: stringField(
            tradeExpression,
            "highestPurityExpression",
          ),
          publicMarketReadThrough: stringField(
            tradeExpression,
            "publicMarketReadThrough",
          ),
          decision: stringField(tradeExpression, "decision"),
          reason: stringField(tradeExpression, "reason"),
          candidateExpressions: arrayField(
            tradeExpression,
            "candidateExpressions",
          ).map(candidateExpressionSummary),
        }
      : null,
    toolCalls: input.trace.map((event) => ({
      stepId: event.stepId,
      name: event.name,
      kind: event.kind,
      status: event.status,
      model: event.model,
      durationMs: event.durationMs,
      visibleReasoning: event.thinkingTrace,
      tokens: event.usage,
      error: event.error,
    })),
    tokenUsage: input.tokenUsage,
  };
}

export function formatVisibilityReport(
  report: ReturnType<typeof buildVisibilityReport>,
): string {
  const lines = [
    "Decision ledger",
    `  response: ${report.decisionLedger.responseType ?? "unknown"}`,
    `  action: ${report.decisionLedger.actionState ?? "unknown"}`,
    `  trade: ${report.decisionLedger.tradeDecision ?? "unknown"}${report.decisionLedger.tradeReason ? ` - ${report.decisionLedger.tradeReason}` : ""}`,
    `  market routed: ${report.decisionLedger.marketRouted}`,
    `  ticket created: ${report.decisionLedger.ticketCreated}`,
    "",
    "Trade expression",
    ...formatTradeExpression(report.tradeExpression),
    "",
    "Tool calls",
    ...report.toolCalls.map((call) => {
      const tokenText =
        call.tokens?.totalTokens != null
          ? ` tokens=${call.tokens.totalTokens}`
          : "";
      return `  [${call.stepId}] ${call.status} ${call.name}${call.model ? ` (${call.model})` : ""} ${call.durationMs ?? 0}ms${tokenText} - ${call.visibleReasoning}`;
    }),
    "",
    "Token usage",
    `  total=${report.tokenUsage.totalTokens ?? "unknown"} input=${report.tokenUsage.inputTokens ?? "unknown"} output=${report.tokenUsage.outputTokens ?? "unknown"} reasoning=${report.tokenUsage.reasoningTokens ?? "unknown"} cacheRead=${report.tokenUsage.cacheReadTokens ?? "unknown"}`,
  ];

  return lines.join("\n");
}

function extractRun(value: unknown): RecordValue | null {
  const record = objectOrNull(value);
  if (!record) {
    return null;
  }

  return objectOrNull(record.run) ?? record;
}

function findTradeExpression(
  run: RecordValue | null,
  trace: TraceEvent[],
): RecordValue | null {
  return (
    objectField(run, "tradeExpression") ??
    findTraceOutput(trace, "cassie_trade_expression")
  );
}

function findTraceOutput(
  trace: TraceEvent[],
  name: string,
): RecordValue | null {
  const event = trace.find(
    (candidate) => candidate.name === name && candidate.output,
  );
  return objectOrNull(event?.output);
}

function formatTradeExpression(
  expression: ReturnType<typeof buildVisibilityReport>["tradeExpression"],
) {
  if (!expression) {
    return ["  none"];
  }

  return [
    `  decision: ${expression.decision ?? "unknown"} - ${expression.reason ?? ""}`,
    `  direct asset: ${expression.directAsset ?? "none"} tradable=${expression.directAssetTradable}`,
    `  read-through: ${expression.publicMarketReadThrough ?? "unknown"}`,
    `  highest purity: ${expression.highestPurityExpression ?? ""}`,
    ...expression.candidateExpressions.map(
      (candidate) =>
        `  - ${candidate.abstractMarket ?? "unknown"} ${candidate.intendedSide ?? "unknown"} rail=${candidate.expressionRail ?? "unknown"} direct=${candidate.directness ?? "unknown"} confidence=${candidate.confidence ?? "?"}`,
    ),
  ];
}

function candidateExpressionSummary(candidate: unknown) {
  return {
    abstractMarket: stringField(candidate, "abstractMarket"),
    intendedSide: stringField(candidate, "intendedSide"),
    expressionRail: stringField(candidate, "expressionRail"),
    directness: stringField(candidate, "directness"),
    confidence: numberField(candidate, "confidence"),
  };
}

function hasField(record: RecordValue | null, field: string): boolean {
  return Boolean(record && record[field] != null);
}

function objectField(
  record: RecordValue | null,
  field: string,
): RecordValue | null {
  return objectOrNull(record?.[field]);
}

function arrayField(record: RecordValue | null, field: string): unknown[] {
  const value = record?.[field];
  return Array.isArray(value) ? value : [];
}

function stringField(record: unknown, field: string): string | null {
  const value = objectOrNull(record)?.[field];
  return typeof value === "string" ? value : null;
}

function nullableStringField(record: unknown, field: string): string | null {
  const value = objectOrNull(record)?.[field];
  return typeof value === "string" ? value : null;
}

function numberField(record: unknown, field: string): number | null {
  const value = objectOrNull(record)?.[field];
  return typeof value === "number" ? value : null;
}

function booleanField(record: unknown, field: string): boolean | null {
  const value = objectOrNull(record)?.[field];
  return typeof value === "boolean" ? value : null;
}

function objectOrNull(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}
