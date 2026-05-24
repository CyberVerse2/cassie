import { describe, expect, it } from "vitest";
import { frameOpportunity, generateTradeExpressions } from "../packages/agent/tools.ts";
import type {
  MarketCandidate,
  SourcePost,
} from "../packages/core/schemas/index.ts";
import { TradeExpressionPlanSchema } from "../packages/core/schemas/index.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "1",
  url: "https://x.com/example/status/1",
  authorHandle: "source",
  authorName: "Source",
  text: "ZEC relative to BTC could rerate.",
  createdAt: "2026-05-22T00:00:00.000Z",
};

const zecCandidate: MarketCandidate = {
  venue: "hyperliquid",
  instrument: "perp",
  side: "long",
  symbol: "ZEC-USDC",
  markPrice: 643,
  liquidityScore: 0.8,
  spreadBps: 4,
  estimatedSlippageBps: 3,
  minOrderSizeUsd: 10,
  thesisFit: 0.86,
  reason: "Direct ZEC perp maps to the thesis asset.",
};

describe("trade expression planning", () => {
  it("blocks AI trade expression until prompts are rewritten", async () => {
    const ai = {
      async generateObject() {
        throw new Error("AI should not run while prompts are removed.");
      },
    };

    await expect(frameOpportunity({
      ai,
      sourcePost,
      userCommand: "what's the trade here?",
    })).rejects.toThrow("Cassie prompts have been removed");

    await expect(generateTradeExpressions({
      ai,
      sourcePost,
      userCommand: "what's the trade here?",
      marketCandidates: [zecCandidate],
    })).rejects.toThrow("Cassie prompts have been removed");
  });

  it("validates ranked trade-expression candidates separately from expected edge", () => {
    const parsed = TradeExpressionPlanSchema.parse({
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
      rankedCandidates: [
        {
          rank: 1,
          candidateId: "hyperliquid|ZEC|long",
          venue: "hyperliquid",
          symbol: "ZEC",
          side: "long",
          expressionConfidence: 0.9,
          thesisFit: 0.8,
          causalDirectness: 0.9,
          liquidity: 0.7,
          venueConfirmation: 1,
          priceOrOddsConfidence: 0.6,
          timingFit: 0.5,
          expectedEdge: -0.1,
          tradableNow: true,
          reason: "Clean expression, but edge may be gone.",
          invalidation: [],
        },
      ],
      decision: "no_trade",
      reason: "Expression is clean but expected edge is negative.",
      insufficiency: null,
      marketRouterInstructions: null,
    });

    expect(parsed.rankedCandidates?.[0]?.expressionConfidence).toBe(0.9);
    expect(parsed.rankedCandidates?.[0]?.expectedEdge).toBe(-0.1);
  });
});
