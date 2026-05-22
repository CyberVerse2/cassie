import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { findPolymarketMarkets, selectMarket } from "../packages/ai/tools/market.ts";
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
  highestPurityExpression: "SpaceX private equity",
  publicMarketReadThrough: "weak",
  candidates: [],
  decision: "needs_market_check",
  reason: "No configured venue candidate exists.",
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
      selectedMarket: null,
      rejectedCandidates: [],
      noTradeReason: "No configured market-data candidate matched the trade expression.",
    });
  });

  it("passes discovered Polymarket candidates into AI market selection", async () => {
    const polymarketCandidate: MarketCandidate = {
      venue: "polymarket",
      instrument: "spacex-ipo-in-2026",
      side: "buy_yes",
      symbol: "spacex-ipo-in-2026",
      conditionId: "condition",
      outcomeTokenId: "yes-token",
      markPrice: 0.42,
      liquidityScore: 0.7,
      spreadBps: 120,
      estimatedSlippageBps: 10,
      minOrderSizeUsd: 1,
      thesisFit: 0.7,
      reason: "Question maps to the IPO thesis.",
    };

    const result = await selectMarket({
      ai: {
        async generateObject({ prompt }) {
          expect(prompt).toContain("spacex-ipo-in-2026");
          return {
            selectedMarket: polymarketCandidate,
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
    });

    expect(result.selectedMarket?.venue).toBe("polymarket");
  });

  it("finds Polymarket markets through the configured finder dependency", async () => {
    const polymarketCandidate: MarketCandidate = {
      venue: "polymarket",
      instrument: "sol-etf-approved",
      side: "buy_yes",
      symbol: "sol-etf-approved",
      conditionId: "condition",
      outcomeTokenId: "yes-token",
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
      },
      thesis,
      tradeExpression,
      limit: 5,
    });

    expect(result).toEqual([polymarketCandidate]);
  });
});
