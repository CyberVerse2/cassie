import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { selectMarket } from "../packages/ai/tools/market.ts";
import type { Thesis, TradeExpressionPlan } from "../packages/core/schemas/index.ts";

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
});
