import { describe, expect, it } from "vitest";
import {
  CandidateTradeExpressionSchema,
  ExpressionFitAssessmentSchema,
  NoTradeCaseSchema,
  OpportunityFrameSchema,
  TradeTicketSchema,
  TradeExpressionPlanSchema,
} from "../packages/core/schemas/index.ts";
import { enforceFitScoreInvariant } from "../packages/agent/fit-assessment.ts";

describe("schema normalization", () => {
  it("describes ambiguous structured-output fields for provider schema guidance", () => {
    expect(
      OpportunityFrameSchema.shape.signalVerificationRisk.description,
    ).toContain("risk that the source claim is false");
    expect(
      CandidateTradeExpressionSchema.shape.directness.description,
    ).toContain("causal exposure");
    expect(
      CandidateTradeExpressionSchema.shape.requiredRuleOrContractFeatures
        .description,
    ).toContain("contract terms");
    expect(NoTradeCaseSchema.shape.reason.description).toContain(
      "no configured venue market was found",
    );
    const baseFitAssessment = {
      candidateId: "hyperliquid:BTC:long",
      expressionId: "btc_long",
      expressionRail: "crypto",
      venue: "hyperliquid",
      intendedSide: "long",
      sideFit: "correct",
      directness: "direct",
      semanticFitSummary: "BTC long maps directly to the BTC long expression.",
      ruleOrContractFitSummary: "Venue listing maps to BTC perp exposure.",
      basisRisks: [],
      mismatchReasons: [],
      requiredFollowUp: [],
      confidence: 0.9,
    };
    expect(
      ExpressionFitAssessmentSchema.parse({
        ...baseFitAssessment,
        fitStatus: "validated",
        fitScore: 0.9,
      }),
    ).toMatchObject({ fitStatus: "validated" });
    expect(() =>
      enforceFitScoreInvariant(
        ExpressionFitAssessmentSchema.parse({
          ...baseFitAssessment,
          fitStatus: "validated",
          fitScore: 0.69,
        }),
      ),
    ).toThrow();
    expect(() =>
      enforceFitScoreInvariant(
        ExpressionFitAssessmentSchema.parse({
          ...baseFitAssessment,
          fitStatus: "rejected",
          fitScore: 0.82,
        }),
      ),
    ).toThrow();
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
      decision: "no_trade",
      reason: "Expression is clean but expected edge is negative.",
      insufficiency: null,
    };

    expect(() => TradeExpressionPlanSchema.parse(basePlan)).toThrow();
    expect(
      TradeExpressionPlanSchema.parse({
        ...basePlan,
        candidateExpressions: [],
        discardedExpressions: [],
        noTradeCase: null,
        marketDiscovery: null,
      }),
    ).toMatchObject({
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
    });
  });

  it("accepts broad asset-class expression rails without making them executable venues", () => {
    const plan = TradeExpressionPlanSchema.parse({
      signal: "Macro signal favors gold and volatility.",
      coreInterpretation:
        "The clean expressions span commodities, public markets, and volatility.",
      directAsset: null,
      directAssetTradable: false,
      evidenceConfidence: 0.6,
      marketDiscoveryConfidence: 0.2,
      tradeExpressionConfidence: 0.5,
      highestPurityExpression:
        "Use a configured venue only if it lists a direct matching instrument.",
      publicMarketReadThrough: "strong",
      candidateExpressions: [
        {
          expressionId: "gold_commodity",
          expressionRail: "commodity",
          expressionType: "directional",
          abstractMarket: "Gold spot, perp, or synthetic exposure",
          intendedSide: "long",
          primaryEntityOrEvent: "gold",
          thesis: "Gold should rally.",
          directness: "direct",
          searchTerms: ["XAUT", "PAXG", "gold"],
          requiredMarketFeatures: ["direct gold exposure"],
          requiredRuleOrContractFeatures: ["tracks gold"],
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
          thesis: "AI capex read-through favors Nvidia.",
          directness: "direct",
          searchTerms: ["NVDA"],
          requiredMarketFeatures: ["direct NVDA exposure"],
          requiredRuleOrContractFeatures: ["tracks NVDA"],
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
          thesis: "Volatility should expand.",
          directness: "direct",
          searchTerms: ["VIX call"],
          requiredMarketFeatures: ["listed option"],
          requiredRuleOrContractFeatures: ["option contract"],
          expectedTimeHorizon: "days",
          priority: "low",
          confidence: 0.3,
        },
      ],
      discardedExpressions: [],
      noTradeCase: {
        shouldConsiderNoTrade: true,
        reason:
          "No trade if configured venues do not list the direct exposure.",
        whatWouldChangeThis: ["Configured venue listing."],
      },
      decision: "needs_market_check",
      reason:
        "Some rails can be searched on configured venues; unsupported rails remain non-executable.",
      insufficiency: null,
      marketDiscovery: {
        status: "needed",
        venues: ["hyperliquid"],
        missing: ["market_discovery"],
        instructions: "Search only configured venues.",
        queries: [],
      },
    });

    expect(
      plan.candidateExpressions.map((candidate) => candidate.expressionRail),
    ).toEqual(["commodity", "public_equity", "options_volatility"]);
    expect(plan).not.toHaveProperty("candidates");
  });

  it("strips legacy trade-expression candidate scoring fields", () => {
    const plan = TradeExpressionPlanSchema.parse({
      signal: "ZEC to reach 3-5% of BTC market cap",
      coreInterpretation:
        "Signal analysis rejected the speculative ZEC/BTC pair thesis.",
      directAsset: "ZEC",
      directAssetTradable: true,
      evidenceConfidence: 0.2,
      marketDiscoveryConfidence: 0.4,
      tradeExpressionConfidence: 0.3,
      highestPurityExpression: "Long ZEC / short BTC pair",
      publicMarketReadThrough: "none",
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
      decision: "no_trade",
      reason: "No configured venue market was found for the thesis.",
      insufficiency: null,
      marketDiscovery: null,
      candidates: [{ expectedEdge: -0.8 }],
    });

    expect(plan).not.toHaveProperty("candidates");
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
    expect(
      TradeTicketSchema.parse({
        ...ticket,
        exitPlan: {
          takeProfitPct: 10,
          stopLossPct: 5,
          maxHoldDays: 7,
          reviewCadence: "daily",
          thesis: "SOL may rally.",
          invalidationSignals: ["SOL thesis failed."],
        },
      }),
    ).toMatchObject({
      exitPlan: {
        takeProfitPct: 10,
        stopLossPct: 5,
        maxHoldDays: 7,
      },
    });
  });
});
