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
      .toContain("no configured venue market was found");
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

  it("accepts broad asset-class expression rails without making them executable venues", () => {
    const plan = TradeExpressionPlanSchema.parse({
      signal: "Macro signal favors gold and volatility.",
      coreInterpretation: "The clean expressions span commodities, public markets, and volatility.",
      directAsset: null,
      directAssetTradable: false,
      evidenceConfidence: 0.6,
      marketDiscoveryConfidence: 0.2,
      tradeExpressionConfidence: 0.5,
      highestPurityExpression: "Use a configured venue only if it lists a direct matching instrument.",
      publicMarketReadThrough: "strong",
      candidates: [{
        instrument: "VIX call option",
        venue: null,
        symbol: null,
        instrumentType: "option",
        venueQuery: null,
        expression: "no_trade",
        thesis: "Long volatility is clean but unsupported by configured venues.",
        venueChecks: ["Configured options venue required"],
        currentMarketPriceOrOdds: null,
        fairValueOrExpectedValue: null,
        causalDirectness: 0.9,
        liquidity: 0,
        surprise: 0.5,
        timing: 0.5,
        crowdingRisk: 0.5,
        downsideAsymmetry: 0.5,
        evidenceQuality: 0.6,
        expectedEdge: 0,
        tradableNow: false,
        rejectionReason: "No configured options venue.",
        invalidation: [],
        evidenceNeeded: ["Configured options connector"],
      }],
      rankedCandidates: [],
      candidateExpressions: [
        {
          expressionId: "gold_commodity",
          expressionRail: "commodity",
          expressionType: "directional",
          abstractMarket: "Gold spot, perp, or synthetic exposure",
          intendedSide: "long",
          primaryEntityOrEvent: "gold",
          relatedEntities: ["XAUT", "PAXG"],
          thesis: "Gold should rally.",
          whyThisExpressesTheOpportunity: "Gold is the direct commodity expression.",
          directness: "direct",
          whatMustBeTrue: ["A configured venue lists direct gold exposure."],
          searchTerms: ["XAUT", "PAXG", "gold"],
          requiredMarketFeatures: ["direct gold exposure"],
          requiredRuleOrContractFeatures: ["tracks gold"],
          keyRisks: ["Basis risk"],
          expectedTimeHorizon: "days",
          priority: "high",
          confidence: 0.6,
        },
        {
          expressionId: "nvda_public_equity",
          expressionRail: "public_equity",
          expressionType: "directional",
          abstractMarket: "NVDA equity or configured synthetic",
          intendedSide: "long",
          primaryEntityOrEvent: "NVDA",
          relatedEntities: ["Nvidia"],
          thesis: "AI capex read-through favors Nvidia.",
          whyThisExpressesTheOpportunity: "NVDA is the direct public-equity expression.",
          directness: "direct",
          whatMustBeTrue: ["A configured venue lists NVDA exposure."],
          searchTerms: ["NVDA"],
          requiredMarketFeatures: ["direct NVDA exposure"],
          requiredRuleOrContractFeatures: ["tracks NVDA"],
          keyRisks: ["No configured listing"],
          expectedTimeHorizon: "weeks",
          priority: "medium",
          confidence: 0.5,
        },
        {
          expressionId: "vix_options",
          expressionRail: "options_volatility",
          expressionType: "directional",
          abstractMarket: "VIX call option",
          intendedSide: "long",
          primaryEntityOrEvent: "VIX",
          relatedEntities: [],
          thesis: "Volatility should expand.",
          whyThisExpressesTheOpportunity: "Options are the direct volatility structure.",
          directness: "direct",
          whatMustBeTrue: ["A configured options venue exists."],
          searchTerms: ["VIX call"],
          requiredMarketFeatures: ["listed option"],
          requiredRuleOrContractFeatures: ["option contract"],
          keyRisks: ["Unsupported venue"],
          expectedTimeHorizon: "days",
          priority: "low",
          confidence: 0.3,
        },
      ],
      discardedExpressions: [],
      noTradeCase: {
        shouldConsiderNoTrade: true,
        reason: "No trade if configured venues do not list the direct exposure.",
        whatWouldChangeThis: ["Configured venue listing."],
      },
      decision: "needs_market_check",
      reason: "Some rails can be searched on configured venues; unsupported rails remain non-executable.",
      insufficiency: null,
      marketRouterInstructions: "Search only configured venues.",
    });

    expect(plan.candidateExpressions.map((candidate) => candidate.expressionRail)).toEqual([
      "commodity",
      "public_equity",
      "options_volatility",
    ]);
    expect(plan.candidates[0]?.instrumentType).toBe("option");
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
          rejectionReason: "No matching configured venue market was found.",
          invalidation: ["ZEC/BTC breaks structural resistance."],
          evidenceNeeded: ["Institutional custody adoption."],
        },
      ],
      rankedCandidates: [],
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
      decision: "no_trade",
      reason: "No configured venue market was found for the thesis.",
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
