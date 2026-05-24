import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { assessPolymarketMarket, findPolymarketMarkets, quotePolymarketMarket, selectMarket } from "../packages/adapters/selection.ts";
import type { MarketCandidate, Thesis, TradeExpressionPlan } from "../packages/core/schemas/index.ts";

const thesis: Thesis = {
  claim: "SpaceX IPO may be actionable.",
  direction: "bullish",
  mentionedAssets: ["SpaceX"],
  topics: ["IPO"],
  timeHorizon: "event_based",
  evidenceQuality: "medium",
  manipulationRisk: "medium",
  confidence: 0.7,
};

const tradeExpression: TradeExpressionPlan = {
  signal: "SpaceX IPO",
  coreInterpretation: "Direct SpaceX is not available through configured venues.",
  directAsset: "SpaceX",
  directAssetTradable: false,
  evidenceConfidence: 0.7,
  marketDiscoveryConfidence: 0.2,
  tradeExpressionConfidence: 0.4,
  highestPurityExpression: "SpaceX private equity",
  publicMarketReadThrough: "weak",
  candidates: [],
  rankedCandidates: [],
  candidateExpressions: [],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "needs_market_check",
  reason: "No configured venue candidate exists.",
  insufficiency: null,
  marketRouterInstructions: null,
};

describe("market selection", () => {
  it("returns deterministic no-trade when no market-data candidates exist", async () => {
    const result = await selectMarket({
      ai: {
        async generateObject() {
          throw new Error("AI should not select from an empty candidate set.");
        },
      } as StructuredAiClient,
      marketData: {
        async findCandidates() {
          return [];
        },
      },
      thesis,
      tradeExpression,
    });

    expect(result).toEqual({
      decision: "no_selection",
      selectedMarket: null,
      selectedCandidateId: null,
      rejectionReason: "No configured market-data candidate matched the trade expression.",
      rankedCandidates: [],
      rejectedCandidates: [],
      noTradeReason: "No configured market-data candidate matched the trade expression.",
    });
  });

  it("uses AI ranking only after real venue candidates are supplied", async () => {
    const polymarketCandidate: MarketCandidate = {
      venue: "polymarket",
      instrument: "spacex-ipo-in-2026",
      side: "buy_yes",
      symbol: "spacex-ipo-in-2026",
      conditionId: "condition",
      outcomeTokenId: "yes-token",
      yesOutcomeTokenId: "yes-token",
      noOutcomeTokenId: "no-token",
      marketQuestion: "Will SpaceX IPO in 2026?",
      marketSlug: "spacex-ipo-in-2026",
      outcome: "yes",
      yesPrice: 0.42,
      noPrice: 0.58,
      heldSidePrice: 0.42,
      volumeUsd: 25000,
      liquidityUsd: 10000,
      endDate: null,
      warnings: [],
      markPrice: 0.42,
      liquidityScore: 0.7,
      spreadBps: 120,
      estimatedSlippageBps: 10,
      minOrderSizeUsd: 1,
      thesisFit: 0.7,
      reason: "Question maps to the IPO thesis.",
    };

    const calls: string[] = [];
    await expect(selectMarket({
      ai: {
        async generateObject(input) {
          calls.push(input.prompt);
          return {
            decision: "select_market",
            selectedMarket: polymarketCandidate,
            selectedCandidateId: "polymarket|spacex-ipo-in-2026|buy_yes",
            rejectionReason: null,
            rankedCandidates: [],
            rejectedCandidates: [],
            noTradeReason: null,
          };
        },
      } as StructuredAiClient,
      marketData: {
        async findCandidates() {
          return [];
        },
      },
      thesis,
      tradeExpression,
      candidates: [polymarketCandidate],
    })).resolves.toMatchObject({
      selectedMarket: polymarketCandidate,
      noTradeReason: null,
    });
    expect(calls[0]).toContain("Rank real venue candidates");
    expect(calls[0]).toContain("Do not select a trade just because the tweet is interesting");
  });

  it("finds Polymarket markets through the configured finder dependency", async () => {
    const polymarketCandidate: MarketCandidate = {
      venue: "polymarket",
      instrument: "sol-etf-approved",
      side: "buy_yes",
      symbol: "sol-etf-approved",
      conditionId: "condition",
      outcomeTokenId: "yes-token",
      yesOutcomeTokenId: "yes-token",
      noOutcomeTokenId: "no-token",
      marketQuestion: "Will a Solana ETF be approved?",
      marketSlug: "sol-etf-approved",
      outcome: "yes",
      yesPrice: 0.51,
      noPrice: 0.49,
      heldSidePrice: 0.51,
      volumeUsd: 50000,
      liquidityUsd: 20000,
      endDate: null,
      warnings: [],
      markPrice: 0.51,
      liquidityScore: 0.8,
      spreadBps: 90,
      estimatedSlippageBps: 4,
      minOrderSizeUsd: 1,
      thesisFit: 0.7,
      reason: "Question maps to the ETF approval thesis.",
    };

    const result = await findPolymarketMarkets({
      polymarket: {
        async findPolymarketMarkets(input) {
          expect(input.limit).toBe(5);
          return [polymarketCandidate];
        },
        async assessPolymarketMarket() {
          throw new Error("not used");
        },
        async quotePolymarketMarket() {
          throw new Error("not used");
        },
      },
      thesis,
      tradeExpression,
      limit: 5,
    });

    expect(result).toEqual([polymarketCandidate]);
  });

  it("assesses a Polymarket market through the configured finder dependency", async () => {
    const result = await assessPolymarketMarket({
      polymarket: {
        async findPolymarketMarkets() {
          return [];
        },
        async assessPolymarketMarket(input) {
          expect(input.side).toBe("no");
          return {
            fit: "strong",
            fitReason: "The contract resolves the exact approval event by the thesis horizon.",
            warnings: ["liquidity_under_10000"],
            trade: {
              venue: "polymarket",
              instrument: "sol-etf-approved",
              side: "buy_no",
              symbol: "sol-etf-approved",
              conditionId: "condition",
              outcomeTokenId: "no-token",
              yesOutcomeTokenId: "yes-token",
              noOutcomeTokenId: "no-token",
              marketQuestion: "Will a Solana ETF be approved?",
              marketSlug: "sol-etf-approved",
              outcome: "no",
              yesPrice: 0.37,
              noPrice: 0.63,
              heldSidePrice: 0.63,
              volumeUsd: 50000,
              liquidityUsd: 5000,
              endDate: null,
              markPrice: 0.63,
              liquidityScore: 0.2,
              spreadBps: 150,
              estimatedSlippageBps: 12,
              minOrderSizeUsd: 1,
              thesisFit: 0.9,
              reason: "The market directly prices approval.",
              warnings: ["liquidity_under_10000"],
            },
          };
        },
        async quotePolymarketMarket() {
          throw new Error("not used");
        },
      },
      thesis,
      tradeExpression,
      market: {
        conditionId: "condition",
        marketSlug: "sol-etf-approved",
        question: "Will a Solana ETF be approved?",
      },
      side: "no",
    });

    expect(result.trade.outcome).toBe("no");
    expect(result.trade.heldSidePrice).toBe(0.63);
  });

  it("quotes a Polymarket market through the configured finder dependency", async () => {
    const result = await quotePolymarketMarket({
      polymarket: {
        async findPolymarketMarkets() {
          return [];
        },
        async assessPolymarketMarket() {
          throw new Error("not used");
        },
        async quotePolymarketMarket(input) {
          expect(input.side).toBe("no");
          return {
            conditionId: "condition",
            outcomeTokenId: "no-token",
            outcome: "no",
            yesPrice: 0.41,
            noPrice: 0.59,
            heldSidePrice: 0.59,
            bid: 0.58,
            ask: 0.6,
            midPrice: 0.59,
            spreadBps: 339,
            timestamp: "2026-05-22T00:00:00.000Z",
          };
        },
      },
      conditionId: "condition",
      outcomeTokenId: "no-token",
      side: "no",
    });

    expect(result.yesPrice).toBe(0.41);
    expect(result.heldSidePrice).toBe(0.59);
  });
});
