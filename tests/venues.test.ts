import { describe, expect, it } from "vitest";
import { searchVenues } from "../packages/agent/venues.ts";
import type { MarketCandidate, TradeExpressionPlan } from "../packages/core/schemas/index.ts";

const tradeExpression: TradeExpressionPlan = {
  signal: "AI inference demand is accelerating.",
  coreInterpretation: "Named projects should drive discovery before generic AI proxies.",
  directAsset: null,
  directAssetTradable: false,
  evidenceConfidence: 0.7,
  marketDiscoveryConfidence: 0.3,
  tradeExpressionConfidence: 0.5,
  highestPurityExpression: "Find a named-project or event market before considering generic proxies.",
  publicMarketReadThrough: "moderate",
  candidates: [],
  rankedCandidates: [],
  decision: "needs_market_check",
  reason: "Needs venue confirmation.",
  insufficiency: null,
  marketRouterInstructions: "Search named project anchors first.",
};

const polymarketCandidate: MarketCandidate = {
  venue: "polymarket",
  instrument: "will-bittensor-hit-revenue-milestone",
  side: "buy_yes",
  symbol: "will-bittensor-hit-revenue-milestone",
  conditionId: "condition",
  outcomeTokenId: "yes-token",
  markPrice: 0.42,
  liquidityScore: 0.7,
  spreadBps: 120,
  estimatedSlippageBps: 10,
  minOrderSizeUsd: 1,
  thesisFit: 0.72,
  reason: "Bittensor was explicitly named in the source context.",
};

describe("venue search", () => {
  it("lets one venue return candidates when another venue fails", async () => {
    const candidates = await searchVenues({
      marketData: {
        async findCandidates() {
          throw new Error("Hyperliquid unavailable");
        },
      },
      polymarket: {
        async findPolymarketMarkets() {
          return [polymarketCandidate];
        },
        async assessPolymarketMarket() {
          throw new Error("not used");
        },
        async quotePolymarketMarket() {
          throw new Error("not used");
        },
      },
      thesis: {
        claim: "Bittensor was named in an AI inference post.",
        direction: "bullish",
        mentionedAssets: ["Bittensor"],
        topics: ["AI inference"],
        timeHorizon: "event_based",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.7,
      },
      tradeExpression,
      venues: ["hyperliquid", "polymarket"],
    });

    expect(candidates).toEqual([polymarketCandidate]);
  });
});
