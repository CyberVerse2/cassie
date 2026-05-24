import { describe, expect, it } from "vitest";
import { searchVenues } from "../packages/agent/venues.ts";
import type { MarketCandidate, TradeExpressionPlan } from "../packages/core/schemas/index.ts";

const tradeExpression: TradeExpressionPlan = {
  signal: "AI inference demand is accelerating.",
  coreInterpretation: "Named projects should drive discovery before generic AI proxies.",
  directAsset: "Bittensor",
  directAssetTradable: true,
  evidenceConfidence: 0.7,
  marketDiscoveryConfidence: 0.3,
  tradeExpressionConfidence: 0.5,
  highestPurityExpression: "Find a named-project or event market before considering generic proxies.",
  publicMarketReadThrough: "moderate",
  candidates: [],
  rankedCandidates: [],
  candidateExpressions: [],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "needs_market_check",
  reason: "Needs venue confirmation.",
  insufficiency: null,
  marketRouterInstructions: "Search named project anchors first.",
};

const nonTradableExpression: TradeExpressionPlan = {
  ...tradeExpression,
  directAsset: null,
  directAssetTradable: false,
};

const polymarketCandidate: MarketCandidate = {
  venue: "polymarket",
  instrument: "will-bittensor-hit-revenue-milestone",
  side: "buy_yes",
  symbol: "will-bittensor-hit-revenue-milestone",
  conditionId: "condition",
  outcomeTokenId: "yes-token",
  yesOutcomeTokenId: "yes-token",
  noOutcomeTokenId: "no-token",
  marketQuestion: "Will Bittensor hit the revenue milestone?",
  marketSlug: "will-bittensor-hit-revenue-milestone",
  outcome: "yes",
  yesPrice: 0.42,
  noPrice: 0.58,
  heldSidePrice: 0.42,
  volumeUsd: 50000,
  liquidityUsd: 25000,
  endDate: null,
  warnings: [],
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

  it("does not search venues when the trade expression has no directly tradable asset", async () => {
    let marketSearches = 0;
    let polymarketSearches = 0;
    const candidates = await searchVenues({
      marketData: {
        async findCandidates() {
          marketSearches += 1;
          return [polymarketCandidate];
        },
      },
      polymarket: {
        async findPolymarketMarkets() {
          polymarketSearches += 1;
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
        claim: "Generic proxy idea.",
        direction: "unclear",
        mentionedAssets: [],
        topics: [],
        timeHorizon: "unclear",
        evidenceQuality: "unknown",
        manipulationRisk: "unknown",
        confidence: 0.4,
      },
      tradeExpression: nonTradableExpression,
      venues: ["hyperliquid", "polymarket"],
    });

    expect(candidates).toEqual([]);
    expect(marketSearches).toBe(0);
    expect(polymarketSearches).toBe(0);
  });
});
