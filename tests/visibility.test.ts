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
  evidenceConfidence: 0.8,
  marketDiscoveryConfidence: 0.2,
  tradeExpressionConfidence: 0.4,
  highestPurityExpression: "Private exposure to Exa.",
  publicMarketReadThrough: "weak",
  candidates: [
    {
      instrument: "Exa private equity",
      venue: null,
      symbol: null,
      instrumentType: null,
      venueQuery: null,
      expression: "market_check",
      thesis: "Highest purity exposure is private.",
      venueChecks: [],
      currentMarketPriceOrOdds: null,
      fairValueOrExpectedValue: null,
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
  rankedCandidates: [],
  candidateExpressions: [],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "needs_market_check",
  reason: "No clean public expression.",
  insufficiency: null,
  marketRouterInstructions: null,
};

const trace: TraceEvent[] = [
  {
    stepId: 1,
    name: "cassie_trade_expression",
    kind: "ai",
    status: "succeeded",
    startedAt: "2026-05-21T00:00:03Z",
    completedAt: "2026-05-21T00:00:04Z",
    durationMs: 1000,
    model: "deepseek-v4-pro",
    thinkingTrace: "Requesting a structured AI judgment and validating it against the expected schema.",
    input: null,
    output: tradeExpression,
    usage,
    error: null,
  },
];

describe("visibility report", () => {
  it("summarizes decision ledger, trade scores, tool calls, and token usage", () => {
    const report = buildVisibilityReport({
      result: {
        run: {
          responseType: "analysis",
          actionState: "needs_market_check",
          tradeExpression,
        },
      },
      trace,
      tokenUsage: usage,
    });

    expect(report.decisionLedger.responseType).toBe("analysis");
    expect(report.decisionLedger.actionState).toBe("needs_market_check");
    expect(report.decisionLedger.tradeDecision).toBe("needs_market_check");
    expect(report.tradeExpression?.candidates[0]).toMatchObject({
      instrument: "Exa private equity",
      expectedEdge: 0.66,
      tradableNow: false,
    });
    expect(report.toolCalls.map((call) => call.name)).toEqual(["cassie_trade_expression"]);
    expect(report.tokenUsage.totalTokens).toBe(150);
  });
});
