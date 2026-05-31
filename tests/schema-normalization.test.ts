import { describe, expect, it } from "vitest";
import {
  CandidateTradeExpressionSchema,
  ExpressionFitAssessmentSchema,
  NoTradeCaseSchema,
  OpportunityFrameSchema,
  TradeTicketSchema,
  TradeExpressionPlanSchema,
} from "../packages/core/schemas/index.ts";

describe("schema normalization", () => {
  it("describes ambiguous structured-output fields for provider schema guidance", () => {
    expect(OpportunityFrameSchema.shape.signalVerificationRisk.description)
      .toContain("risk that the source claim is false");
    expect(CandidateTradeExpressionSchema.shape.directness.description)
      .toContain("causal exposure");
    expect(CandidateTradeExpressionSchema.shape.requiredRuleOrContractFeatures.description)
      .toContain("contract terms");
    expect(NoTradeCaseSchema.shape.reason.description)
      .toContain("why no trade may be preferable");
    expect(ExpressionFitAssessmentSchema.shape.fitStatus.description)
      .toContain("validated only when");
    expect(ExpressionFitAssessmentSchema.shape.ruleOrContractFitSummary.description)
      .toContain("rules");
  });

  it("requires explicit nullable response fields for trade-expression structured output", () => {
    const basePlan = {
      signal: "ZEC thesis",
      coreInterpretation: "Direct ZEC is the clean expression.",
      directAsset: "ZEC",
      directAssetTradable: true,
      evidenceConfidence: 0.7,
      marketDiscoveryConfidence: 0.8,
      tradeExpressionConfidence: 0.9,
      highestPurityExpression: "Long ZEC perp.",
      publicMarketReadThrough: "none",
      candidates: [],
      rankedCandidates: [],
      decision: "no_trade",
      reason: "Expression is clean but expected edge is negative.",
      insufficiency: null,
      marketRouterInstructions: null,
    };

    expect(() => TradeExpressionPlanSchema.parse(basePlan)).toThrow();
    expect(TradeExpressionPlanSchema.parse({
      ...basePlan,
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
    })).toMatchObject({
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
    });
  });

  it("accepts negative expected edge for no-trade candidates", () => {
    const plan = TradeExpressionPlanSchema.parse({
      signal: "ZEC to reach 3-5% of BTC market cap",
      coreInterpretation: "Signal analysis rejected the speculative ZEC/BTC pair thesis.",
      directAsset: "ZEC",
      directAssetTradable: true,
      evidenceConfidence: 0.2,
      marketDiscoveryConfidence: 0.4,
      tradeExpressionConfidence: 0.3,
      highestPurityExpression: "Long ZEC / short BTC pair",
      publicMarketReadThrough: "none",
      candidates: [
        {
          instrument: "ZECBTC",
          venue: "hyperliquid",
          symbol: "ZECBTC",
          instrumentType: "spot",
          venueQuery: null,
          expression: "no_trade",
          thesis: "Long ZEC against BTC based on BTC holders rebalancing into ZEC.",
          venueChecks: [],
          currentMarketPriceOrOdds: "0.007",
          fairValueOrExpectedValue: "< 0.005",
          causalDirectness: 0.9,
          liquidity: 0.3,
          surprise: 0.1,
          timing: 0.1,
          crowdingRisk: 0.2,
          downsideAsymmetry: 0.1,
          evidenceQuality: 0.2,
          expectedEdge: -0.8,
          tradableNow: false,
          rejectionReason: "The pair has bad expected value.",
          invalidation: ["ZEC/BTC breaks structural resistance."],
          evidenceNeeded: ["Institutional custody adoption."],
        },
      ],
      rankedCandidates: [],
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
      decision: "no_trade",
      reason: "The trade thesis is structurally unviable.",
      insufficiency: null,
      marketRouterInstructions: null,
    });

    expect(plan.candidates[0]?.expectedEdge).toBe(-0.8);
  });

  it("requires an exit plan on trade tickets", () => {
    const ticket = {
      ticketId: "ticket_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "SOL may rally.",
      venue: "hyperliquid",
      instrument: "SOL-PERP",
      side: "long",
      sizeUsd: 50,
      orderType: "marketable_limit",
      venueData: { symbol: "SOL" },
    };

    expect(() => TradeTicketSchema.parse(ticket)).toThrow();
    expect(TradeTicketSchema.parse({
      ...ticket,
      exitPlan: {
        takeProfitPct: 10,
        stopLossPct: 5,
        maxHoldDays: 7,
        reviewCadence: "daily",
        thesis: "SOL may rally.",
        invalidationSignals: ["SOL thesis failed."],
      },
    })).toMatchObject({
      exitPlan: {
        takeProfitPct: 10,
        stopLossPct: 5,
        maxHoldDays: 7,
      },
    });
  });
});
