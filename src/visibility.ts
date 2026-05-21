import type { TraceEvent, TraceUsage } from "./trace.ts";

type VisibilityInput = {
  result: unknown;
  trace: TraceEvent[];
  tokenUsage: TraceUsage;
};

type RecordValue = Record<string, unknown>;

export function buildVisibilityReport(input: VisibilityInput) {
  const run = extractRun(input.result);
  const researchPlan = findTraceOutput(input.trace, "cassie_research_query_plan");
  const tradeExpression = findTradeExpression(run, input.trace);
  const researchReport = findResearchReport(run);

  return {
    decisionLedger: {
      responseType: stringField(run, "responseType"),
      researchConclusion: stringField(researchReport, "researchConclusion"),
      recommendedResearchAction: stringField(researchReport, "recommendedResearchAction"),
      tradeDecision: stringField(tradeExpression, "decision"),
      tradeReason: stringField(tradeExpression, "reason"),
      marketRouted: Boolean(hasField(run, "marketSelection")),
      ticketCreated: Boolean(hasField(run, "tradeTicket")),
    },
    researchGoals: extractResearchGoals(researchPlan),
    goalResolutions: extractGoalResolutions(run, input.trace),
    synthesisContract: objectField(researchPlan, "synthesisContract"),
    evidenceSummary: summarizeEvidence(researchReport),
    tradeExpression: tradeExpression
      ? {
          signal: stringField(tradeExpression, "signal"),
          coreInterpretation: stringField(tradeExpression, "coreInterpretation"),
          directAsset: nullableStringField(tradeExpression, "directAsset"),
          directAssetTradable: booleanField(tradeExpression, "directAssetTradable"),
          highestPurityExpression: stringField(tradeExpression, "highestPurityExpression"),
          publicMarketReadThrough: stringField(tradeExpression, "publicMarketReadThrough"),
          decision: stringField(tradeExpression, "decision"),
          reason: stringField(tradeExpression, "reason"),
          candidates: arrayField(tradeExpression, "candidates").map((candidate) => ({
            instrument: stringField(candidate, "instrument"),
            expression: stringField(candidate, "expression"),
            causalDirectness: numberField(candidate, "causalDirectness"),
            liquidity: numberField(candidate, "liquidity"),
            surprise: numberField(candidate, "surprise"),
            timing: numberField(candidate, "timing"),
            crowdingRisk: numberField(candidate, "crowdingRisk"),
            downsideAsymmetry: numberField(candidate, "downsideAsymmetry"),
            evidenceQuality: numberField(candidate, "evidenceQuality"),
            expectedEdge: numberField(candidate, "expectedEdge"),
            tradableNow: booleanField(candidate, "tradableNow"),
            rejectionReason: nullableStringField(candidate, "rejectionReason"),
          })),
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

export function formatVisibilityReport(report: ReturnType<typeof buildVisibilityReport>): string {
  const lines = [
    "Decision ledger",
    `  response: ${report.decisionLedger.responseType ?? "unknown"}`,
    `  research: ${report.decisionLedger.researchConclusion ?? "unknown"} / ${report.decisionLedger.recommendedResearchAction ?? "unknown"}`,
    `  trade: ${report.decisionLedger.tradeDecision ?? "unknown"}${report.decisionLedger.tradeReason ? ` - ${report.decisionLedger.tradeReason}` : ""}`,
    `  market routed: ${report.decisionLedger.marketRouted}`,
    `  ticket created: ${report.decisionLedger.ticketCreated}`,
    "",
    "Research goals",
    ...formatResearchGoals(report.researchGoals),
    "",
    "Goal resolutions",
    ...formatGoalResolutions(report.goalResolutions),
    "",
    "Evidence",
    `  count: ${report.evidenceSummary.count}`,
    `  warnings: ${report.evidenceSummary.warnings.length > 0 ? report.evidenceSummary.warnings.join(", ") : "none"}`,
    ...report.evidenceSummary.items.map((item) =>
      `  - ${item.title ?? "untitled"} [${item.stance ?? "unknown"}, ${item.reliability ?? "unknown"}]`,
    ),
    "",
    "Trade expression",
    ...formatTradeExpression(report.tradeExpression),
    "",
    "Tool calls",
    ...report.toolCalls.map((call) => {
      const tokenText = call.tokens?.totalTokens != null ? ` tokens=${call.tokens.totalTokens}` : "";
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

function findResearchReport(run: RecordValue | null): RecordValue | null {
  return objectField(run, "researchReport");
}

function findTradeExpression(run: RecordValue | null, trace: TraceEvent[]): RecordValue | null {
  return objectField(run, "tradeExpression") ?? findTraceOutput(trace, "cassie_trade_expression");
}

function findTraceOutput(trace: TraceEvent[], name: string): RecordValue | null {
  const event = trace.find((candidate) => candidate.name === name && candidate.output);
  return objectOrNull(event?.output);
}

function extractResearchGoals(plan: RecordValue | null) {
  return arrayField(plan, "goals").map((goal) => {
    const record = objectOrNull(goal);
    return {
      id: stringField(record, "id"),
      kind: stringField(record, "kind"),
      question: stringField(record, "question"),
      decisionUse: stringField(record, "decisionUse"),
      priority: numberField(record, "priority"),
      mustResolve: booleanField(record, "mustResolve"),
      lanes: arrayField(record, "lanes").map((lane) => String(lane)),
      evidenceNeeds: arrayField(record, "evidenceNeeds").map((need) => String(need)),
      resolutionCriteria: objectField(record, "resolutionCriteria"),
    };
  });
}

function extractGoalResolutions(run: RecordValue | null, trace: TraceEvent[]) {
  const fromRun = arrayField(run, "goalResolutions");
  const fromTrace = trace
    .filter((event) => event.name === "cassie_goal_resolution")
    .flatMap((event) => Array.isArray(event.output) ? event.output : []);

  return [...fromRun, ...fromTrace].map((resolution) => {
    const record = objectOrNull(resolution);
    return {
      goalId: stringField(record, "goalId"),
      status: stringField(record, "status"),
      confidence: numberField(record, "confidence"),
      summary: stringField(record, "summary"),
      synthesisImplication: stringField(record, "synthesisImplication"),
      unresolvedQuestions: arrayField(record, "unresolvedQuestions").map((question) => String(question)),
    };
  });
}

function summarizeEvidence(report: RecordValue | null) {
  const evidence = arrayField(report, "evidence");
  return {
    count: evidence.length,
    warnings: arrayField(report, "warnings").map((warning) => String(warning)),
    items: evidence.map((item) => ({
      title: nullableStringField(item, "title"),
      url: nullableStringField(item, "url"),
      stance: stringField(item, "stance"),
      reliability: stringField(item, "reliability"),
      relevance: numberField(item, "relevance"),
    })),
  };
}

function formatResearchGoals(goals: ReturnType<typeof extractResearchGoals>) {
  if (goals.length === 0) {
    return ["  none"];
  }

  return goals.map((goal) =>
    `  - ${goal.id ?? "unknown"} ${goal.kind ?? "unknown"} p=${goal.priority ?? "?"} must=${goal.mustResolve}: ${goal.question ?? ""}`,
  );
}

function formatGoalResolutions(resolutions: ReturnType<typeof extractGoalResolutions>) {
  if (resolutions.length === 0) {
    return ["  none"];
  }

  return resolutions.map((resolution) =>
    `  - ${resolution.goalId ?? "unknown"} ${resolution.status ?? "unknown"} c=${resolution.confidence ?? "?"}: ${resolution.summary ?? ""}`,
  );
}

function formatTradeExpression(expression: ReturnType<typeof buildVisibilityReport>["tradeExpression"]) {
  if (!expression) {
    return ["  none"];
  }

  return [
    `  decision: ${expression.decision ?? "unknown"} - ${expression.reason ?? ""}`,
    `  direct asset: ${expression.directAsset ?? "none"} tradable=${expression.directAssetTradable}`,
    `  read-through: ${expression.publicMarketReadThrough ?? "unknown"}`,
    `  highest purity: ${expression.highestPurityExpression ?? ""}`,
    ...expression.candidates.map((candidate) =>
      `  - ${candidate.instrument ?? "unknown"} ${candidate.expression ?? "unknown"} edge=${candidate.expectedEdge ?? "?"} direct=${candidate.causalDirectness ?? "?"} liquid=${candidate.liquidity ?? "?"} tradable=${candidate.tradableNow}${candidate.rejectionReason ? ` reject=${candidate.rejectionReason}` : ""}`,
    ),
  ];
}

function hasField(record: RecordValue | null, field: string): boolean {
  return Boolean(record && record[field] != null);
}

function objectField(record: RecordValue | null, field: string): RecordValue | null {
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanField(record: unknown, field: string): boolean | null {
  const value = objectOrNull(record)?.[field];
  return typeof value === "boolean" ? value : null;
}

function objectOrNull(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
