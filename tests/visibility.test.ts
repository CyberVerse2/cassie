import { describe, expect, it } from "vitest";
import type { TradeExpressionPlan } from "../packages/core/schemas/index.ts";
import type { TraceEvent, TraceUsage } from "../packages/core/trace.ts";
import { buildVisibilityReport } from "../src/visibility.ts";

const usage: TraceUsage = {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  reasoningTokens: 20,
  cacheReadTokens: 0,
};

const tradeExpression: TradeExpressionPlan = {
  signal: "Exa raised $250M.",
  coreInterpretation: "Private-market validation of AI search infrastructure.",
  directAsset: "Exa private equity",
  directAssetTradable: false,
  highestPurityExpression: "Private exposure to Exa.",
  publicMarketReadThrough: "weak",
  candidates: [
    {
      instrument: "Exa private equity",
      expression: "market_check",
      thesis: "Highest purity exposure is private.",
      causalDirectness: 0.95,
      liquidity: 0.1,
      surprise: 0.7,
      timing: 0.4,
      crowdingRisk: 0.3,
      downsideAsymmetry: 0.5,
      evidenceQuality: 0.8,
      expectedEdge: 0.66,
      tradableNow: false,
      rejectionReason: "Requires private access.",
      invalidation: ["Round is inaccurate."],
      evidenceNeeded: ["Revenue and valuation work."],
    },
  ],
  decision: "insufficient_evidence",
  reason: "No clean public expression.",
  marketRouterInstructions: null,
};

const trace: TraceEvent[] = [
  {
    stepId: 1,
    name: "cassie_research_query_plan",
    kind: "ai",
    status: "succeeded",
    startedAt: "2026-05-21T00:00:00Z",
    completedAt: "2026-05-21T00:00:01Z",
    durationMs: 1000,
    model: "gemini-3.5-flash",
    thinkingTrace: "Requesting a structured AI judgment and validating it against the expected schema.",
    input: null,
    output: {
      mode: "standard",
      goals: [
        {
          id: "g_verify",
          kind: "event_validation",
          question: "Did Exa raise $250M?",
          decisionUse: "validate_or_kill_thesis",
          priority: 0.95,
          mustResolve: true,
          lanes: ["web"],
          evidenceNeeds: ["Primary confirmation."],
          resolutionCriteria: {
            supportedIf: "Official source confirms it.",
            contradictedIf: "Official source denies it.",
            unresolvedIf: "Only social posts exist.",
          },
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_verify"],
        cannotConcludeIfUnresolved: ["g_verify"],
      },
    },
    usage,
    error: null,
  },
  {
    stepId: 2,
    name: "openai_web_query_job",
    kind: "connector",
    status: "succeeded",
    startedAt: "2026-05-21T00:00:01Z",
    completedAt: "2026-05-21T00:00:02Z",
    durationMs: 1000,
    model: "gpt-5",
    thinkingTrace: "Executing one auditable web query job and classifying returned sources into evidence claims.",
    input: null,
    output: {
      queryJobId: "job_w0_q_verify",
      evidenceClaimCount: 1,
      resultCount: 1,
      ledger: {
        searchResults: [
          {
            id: "result_job_w0_q_verify_1",
            queryId: "q_verify",
            queryJobId: "job_w0_q_verify",
          },
        ],
        evidenceClaims: [
          {
            id: "claim_job_w0_q_verify_1",
            queryId: "q_verify",
            resultId: "result_job_w0_q_verify_1",
            claimText: "Exa raised $250M.",
            reliability: "high",
            directness: "primary",
          },
        ],
        goalEvidenceLinks: [
          {
            goalId: "g_verify",
            evidenceClaimId: "claim_job_w0_q_verify_1",
            stance: "supports",
            strength: 0.9,
            reason: "Primary source confirms the round.",
          },
        ],
      },
    },
    usage,
    error: null,
  },
  {
    stepId: 3,
    name: "cassie_goal_resolution",
    kind: "ai",
    status: "succeeded",
    startedAt: "2026-05-21T00:00:02Z",
    completedAt: "2026-05-21T00:00:03Z",
    durationMs: 1000,
    model: "gemini-3.5-flash",
    thinkingTrace: "Resolving research goals against wave evidence.",
    input: null,
    output: [
      {
        goalId: "g_verify",
        status: "resolved_supported",
        confidence: 0.86,
        summary: "The funding event is supported.",
        synthesisImplication: "The agent may treat the event as verified.",
      },
    ],
    usage,
    error: null,
  },
  {
    stepId: 4,
    name: "cassie_trade_expression",
    kind: "ai",
    status: "succeeded",
    startedAt: "2026-05-21T00:00:03Z",
    completedAt: "2026-05-21T00:00:04Z",
    durationMs: 1000,
    model: "gemini-3.5-flash",
    thinkingTrace: "Requesting a structured AI judgment and validating it against the expected schema.",
    input: null,
    output: tradeExpression,
    usage,
    error: null,
  },
];

describe("visibility report", () => {
  it("summarizes decision ledger, research goals, trade scores, tool calls, and token usage", () => {
    const report = buildVisibilityReport({
      result: {
        run: {
          responseType: "trade_decision",
          tradeExpression,
          researchReport: {
            evidence: [{ title: "Exa funding report", stance: "supports", reliability: "high" }],
            warnings: ["NO_PRIMARY_SOURCE"],
          },
        },
      },
      trace,
      tokenUsage: usage,
    });

    expect(report.decisionLedger.responseType).toBe("trade_decision");
    expect(report.decisionLedger.tradeDecision).toBe("insufficient_evidence");
    expect(report.researchGoals[0]).toMatchObject({
      id: "g_verify",
      kind: "event_validation",
      mustResolve: true,
    });
    expect(report.goalResolutions[0]).toMatchObject({
      goalId: "g_verify",
      status: "resolved_supported",
      confidence: 0.86,
    });
    expect(report.evidenceLedger).toMatchObject({
      searchResultCount: 1,
      evidenceClaimCount: 1,
      goalEvidenceLinkCount: 1,
    });
    expect(report.evidenceLedger.claims[0]).toMatchObject({
      id: "claim_job_w0_q_verify_1",
      queryId: "q_verify",
      claimText: "Exa raised $250M.",
    });
    expect(report.tradeExpression?.candidates[0]).toMatchObject({
      instrument: "Exa private equity",
      expectedEdge: 0.66,
      tradableNow: false,
    });
    expect(report.evidenceSummary.count).toBe(1);
    expect(report.toolCalls.map((call) => call.name)).toEqual([
      "cassie_research_query_plan",
      "openai_web_query_job",
      "cassie_goal_resolution",
      "cassie_trade_expression",
    ]);
    expect(report.tokenUsage.totalTokens).toBe(150);
  });
});
