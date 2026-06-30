import { describe, expect, it } from "vitest";
import { TradeExpressionPlanSchema } from "../packages/core/schemas/index.ts";

const verbosePersistedTradeExpression = {
  signal: "AI PC tailwind",
  coreInterpretation:
    "NVIDIA and Microsoft may benefit from local AI PC adoption.",
  directAsset: "NVDA",
  directAssetTradable: true,
  evidenceConfidence: 0.8,
  marketDiscoveryConfidence: 0.3,
  tradeExpressionConfidence: 0.7,
  highestPurityExpression:
    "Long NVDA if a configured venue lists direct exposure.",
  publicMarketReadThrough: "strong",
  candidateExpressions: [
    {
      expressionId: "ce_nvda_long",
      expressionRail: "public_equity",
      expressionType: "directional",
      abstractMarket: "NVIDIA-linked equity exposure",
      intendedSide: "long",
      primaryEntityOrEvent: "NVIDIA",
      thesis: "NVIDIA is the cleanest beneficiary of local AI PC adoption.",
      directness: "direct",
      searchTerms: ["NVDA", "NVIDIA"],
      requiredMarketFeatures: ["NVDA-linked configured venue route"],
      requiredRuleOrContractFeatures: [],
      expectedTimeHorizon: "months",
      priority: "high",
      confidence: 0.79,
    },
  ],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "needs_market_check",
  reason: "Needs venue discovery.",
  insufficiency: {
    score: 0.5,
    requiredThreshold: 0.7,
    failedDimensions: ["market_discovery"],
    summary: "Venue support is unknown.",
    evidenceNeededToClear: ["Search configured venues."],
  },
  marketDiscovery: {
    status: "needed",
    venues: ["hyperliquid"],
    missing: ["market_discovery"],
    instructions: "Search Hyperliquid for NVDA.",
    queries: [],
  },
};

describe("TradeExpressionPlanSchema", () => {
  it("strips legacy planning fields while parsing old persisted records", () => {
    const parsed = TradeExpressionPlanSchema.parse(
      verbosePersistedTradeExpression,
    );

    expect(parsed).not.toHaveProperty("candidates");
    expect(parsed).not.toHaveProperty("rankedCandidates");
    expect(parsed).not.toHaveProperty("marketRouterInstructions");
    expect(parsed.candidateExpressions[0]?.thesis).toBe(
      "NVIDIA is the cleanest beneficiary of local AI PC adoption.",
    );
  });
});
