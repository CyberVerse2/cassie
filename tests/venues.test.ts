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
  candidateExpressions: [],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "needs_market_check",
  reason: "Needs venue confirmation.",
  insufficiency: null,
  marketDiscovery: { status: "needed", venues: ["hyperliquid"], missing: ["market_discovery"], instructions: "Search named project anchors first.", queries: [] },
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
      hyperliquidMarketData: {
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

  it("surfaces required Polymarket failures instead of returning only direct-venue candidates", async () => {
    const hyperliquidCandidate: MarketCandidate = {
      ...polymarketCandidate,
      venue: "hyperliquid",
      instrument: "perp",
      side: "short",
      symbol: "BTC",
      conditionId: null,
      outcomeTokenId: null,
      yesOutcomeTokenId: null,
      noOutcomeTokenId: null,
      marketQuestion: null,
      marketSlug: null,
      outcome: null,
      yesPrice: null,
      noPrice: null,
      heldSidePrice: null,
      markPrice: 100000,
      reason: "BTC perp was found.",
    };

    await expect(searchVenues({
      hyperliquidMarketData: {
        async findCandidates() {
          return [hyperliquidCandidate];
        },
      },
      polymarket: {
        async findPolymarketMarkets() {
          throw new Error("Polymarket order book is empty for token yes-token.");
        },
        async assessPolymarketMarket() {
          throw new Error("not used");
        },
        async quotePolymarketMarket() {
          throw new Error("not used");
        },
      },
      thesis: {
        claim: "Strategy may sell Bitcoin this year.",
        direction: "bearish",
        mentionedAssets: ["BTC"],
        topics: ["Strategy", "Bitcoin"],
        timeHorizon: "event_based",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.84,
      },
      tradeExpression: {
        ...tradeExpression,
        candidateExpressions: [{
          expressionId: "strat_yes_event",
          expressionRail: "prediction_market",
          expressionType: "event_probability",
          abstractMarket: "Did Strategy sell any Bitcoin by 2026-12-31?",
          intendedSide: "yes",
          primaryEntityOrEvent: "Strategy selling Bitcoin before year-end",
          thesis: "Buy yes on the exact event.",
          directness: "direct",
          searchTerms: ["Strategy sells Bitcoin before 2026-12-31 Polymarket"],
          requiredMarketFeatures: ["Explicit yes/no event market"],
          requiredRuleOrContractFeatures: ["Clear sale resolution criteria"],
          expectedTimeHorizon: "months",
          priority: "high",
          confidence: 0.9,
        }],
      },
      venues: ["hyperliquid", "polymarket"],
    })).rejects.toThrow("Required venue search failed: polymarket: Error: Polymarket order book is empty for token yes-token.");
  });

  it("orders candidates by matching expression priority and confidence", async () => {
    const btcCandidate: MarketCandidate = {
      ...polymarketCandidate,
      venue: "hyperliquid",
      instrument: "perp",
      side: "short",
      symbol: "BTC",
      conditionId: null,
      outcomeTokenId: null,
      yesOutcomeTokenId: null,
      noOutcomeTokenId: null,
      marketQuestion: null,
      marketSlug: null,
      outcome: null,
      yesPrice: null,
      noPrice: null,
      heldSidePrice: null,
      markPrice: 100000,
      reason: "BTC perp was found.",
    };

    const candidates = await searchVenues({
      hyperliquidMarketData: {
        async findCandidates() {
          return [btcCandidate];
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
        claim: "Strategy may sell Bitcoin this year.",
        direction: "bearish",
        mentionedAssets: ["BTC"],
        topics: ["Strategy", "Bitcoin"],
        timeHorizon: "event_based",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.84,
      },
      tradeExpression: {
        ...tradeExpression,
        candidateExpressions: [
          {
            expressionId: "btc_short",
            expressionRail: "crypto",
            expressionType: "directional",
            abstractMarket: "BTC perp",
            intendedSide: "short",
            primaryEntityOrEvent: "Bitcoin",
            thesis: "Short BTC read-through.",
            directness: "direct",
            searchTerms: ["BTC perp"],
            requiredMarketFeatures: ["shortable BTC market"],
            requiredRuleOrContractFeatures: [],
            expectedTimeHorizon: "days",
            priority: "high",
            confidence: 0.82,
          },
          {
            expressionId: "strategy_yes",
            expressionRail: "prediction_market",
            expressionType: "event_probability",
            abstractMarket: "Strategy sells Bitcoin by year-end",
            intendedSide: "yes",
            primaryEntityOrEvent: "Strategy sells Bitcoin",
            thesis: "Buy yes on the exact event.",
            directness: "direct",
            searchTerms: ["Strategy sells Bitcoin 2026"],
            requiredMarketFeatures: ["yes/no market"],
            requiredRuleOrContractFeatures: ["sale definition"],
            expectedTimeHorizon: "months",
            priority: "high",
            confidence: 0.86,
          },
        ],
      },
      venues: ["hyperliquid", "polymarket"],
    });

    expect(candidates.map((candidate) => candidate.venue)).toEqual(["polymarket", "hyperliquid"]);
  });

  it("searches Hyperliquid and Polymarket concurrently when both are requested", async () => {
    const calls: string[] = [];
    let releaseHyperliquid!: () => void;
    const hyperliquidGate = new Promise<void>((resolve) => {
      releaseHyperliquid = resolve;
    });

    const candidates = await searchVenues({
      hyperliquidMarketData: {
        async findCandidates() {
          calls.push("hyperliquid:start");
          await hyperliquidGate;
          calls.push("hyperliquid:end");
          return [];
        },
      },
      polymarket: {
        async findPolymarketMarkets() {
          calls.push("polymarket:start");
          releaseHyperliquid();
          calls.push("polymarket:end");
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
    expect(calls.slice(0, 2)).toEqual(["hyperliquid:start", "polymarket:start"]);
  });

  it("still searches prediction venues when the direct asset is not tradable", async () => {
    let marketSearches = 0;
    let polymarketSearches = 0;
    const candidates = await searchVenues({
      hyperliquidMarketData: {
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

    expect(candidates).toEqual([polymarketCandidate]);
    expect(marketSearches).toBe(0);
    expect(polymarketSearches).toBe(1);
  });

  it("searches configured direct rails when candidate expressions need venue discovery", async () => {
    let marketSearches = 0;
    const candidates = await searchVenues({
      hyperliquidMarketData: {
        async findCandidates() {
          marketSearches += 1;
          return [polymarketCandidate];
        },
      },
      thesis: {
        claim: "Private AI infrastructure signal.",
        direction: "bullish",
        mentionedAssets: ["turbopuffer"],
        topics: ["AI infrastructure"],
        timeHorizon: "weeks",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.5,
      },
      tradeExpression: {
        ...nonTradableExpression,
        directAsset: "turbopuffer",
        decision: "needs_market_check",
        candidateExpressions: [{
          expressionId: "turbopuffer_private_long",
          expressionRail: "pre_ipo",
          expressionType: "directional",
          abstractMarket: "turbopuffer private-company valuation exposure",
          intendedSide: "long",
          primaryEntityOrEvent: "turbopuffer",
          thesis: "Search for a direct private-company listing.",
          directness: "direct",
          searchTerms: ["turbopuffer pre-IPO"],
          requiredMarketFeatures: ["Configured private-company listing"],
          requiredRuleOrContractFeatures: ["Direct valuation exposure"],
          expectedTimeHorizon: "weeks",
          priority: "medium",
          confidence: 0.24,
        }],
      },
      venues: ["hyperliquid"],
    });

    expect(candidates).toEqual([polymarketCandidate]);
    expect(marketSearches).toBe(1);
  });

  it("does not search direct venues for unsupported execution rails", async () => {
    let marketSearches = 0;
    const candidates = await searchVenues({
      hyperliquidMarketData: {
        async findCandidates() {
          marketSearches += 1;
          return [polymarketCandidate];
        },
      },
      thesis: {
        claim: "Volatility should expand after the rate decision.",
        direction: "bullish",
        mentionedAssets: ["VIX"],
        topics: ["volatility", "rates"],
        timeHorizon: "days",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.5,
      },
      tradeExpression: {
        ...nonTradableExpression,
        directAsset: "VIX",
        directAssetTradable: false,
        decision: "no_trade",
        candidateExpressions: [{
          expressionId: "vix_call",
          expressionRail: "options_volatility",
          expressionType: "directional",
          abstractMarket: "VIX call option",
          intendedSide: "long",
          primaryEntityOrEvent: "VIX",
          thesis: "Long volatility would express the thesis.",
          directness: "direct",
          searchTerms: ["VIX call"],
          requiredMarketFeatures: ["listed option"],
          requiredRuleOrContractFeatures: ["option contract"],
          expectedTimeHorizon: "days",
          priority: "high",
          confidence: 0.4,
        }],
      },
      venues: ["hyperliquid"],
    });

    expect(candidates).toEqual([]);
    expect(marketSearches).toBe(0);
  });
});
