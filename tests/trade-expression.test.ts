import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { frameOpportunity, generateTradeExpressions } from "../packages/agent/tools/trade-expression.ts";
import type {
  MarketCandidate,
  OpportunityFrame,
  SourcePost,
  TradeExpressionPlan,
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
  it("frames opportunity and generates trade expressions without running a nested tool loop", async () => {
    const calls: string[] = [];
    const ai = {
      async generateObject<T>(input: { name: string; prompt: string }): Promise<T> {
        calls.push(input.name);
        if (input.name === "cassie_opportunity_frame") {
          expect(input.prompt).toContain("Frame the market opportunity");
          expect(input.prompt).toContain("ZEC relative to BTC could rerate.");
          return {
            literalClaim: "ZEC relative to BTC could rerate.",
            opportunity: "Long ZEC if the rerating thesis is not priced.",
            marketImplication: "Bullish ZEC relative to broader crypto beta.",
            userIntent: "trade",
            affectedEntities: ["Zcash"],
            affectedAssets: ["ZEC"],
            expressionFamilies: ["long ZEC perp", "no trade if venue or beta fit is weak"],
            signalVerificationRisk: "medium",
            shouldVerifyTruthBeforeTrading: false,
            reason: "The post is an opinion thesis, not a specific factual headline.",
            confidence: 0.7,
          } as OpportunityFrame as T;
        }

        expect(input.name).toBe("cassie_trade_expressions");
        expect(input.prompt).toContain("ZEC-USDC");
        return {
          signal: "ZEC relative-value thesis",
          coreInterpretation: "The clean expression is direct long ZEC, not a brittle literal ZEC/BTC pair.",
          directAsset: "ZEC",
          directAssetTradable: true,
          evidenceConfidence: 0.7,
          marketDiscoveryConfidence: 0.9,
          tradeExpressionConfidence: 0.86,
          highestPurityExpression: "Long ZEC perp with BTC as the benchmark.",
          publicMarketReadThrough: "none",
          candidates: [
            {
              instrument: "ZEC-USDC perp",
              venue: "hyperliquid",
              symbol: "ZEC-USDC",
              instrumentType: "perp",
              venueQuery: "ZEC perp",
              expression: "long",
              thesis: "ZEC rerates relative to BTC.",
              venueChecks: ["Hyperliquid ZEC-USDC l2Book"],
              currentMarketPriceOrOdds: "mark 643",
              fairValueOrExpectedValue: "Expected edge remains positive if ZEC rerates faster than BTC.",
              causalDirectness: 0.9,
              liquidity: 0.8,
              surprise: 0.45,
              timing: 0.6,
              crowdingRisk: 0.45,
              downsideAsymmetry: 0.55,
              evidenceQuality: 0.7,
              expectedEdge: 0.2,
              tradableNow: true,
              rejectionReason: null,
              invalidation: ["ZEC move is explained entirely by crypto beta."],
              evidenceNeeded: ["Fresh order book before ticket sizing."],
            },
          ],
          rankedCandidates: [
            {
              rank: 1,
              candidateId: "hyperliquid|ZEC-USDC|long",
              venue: "hyperliquid",
              symbol: "ZEC-USDC",
              side: "long",
              expressionConfidence: 0.86,
              thesisFit: 0.86,
              causalDirectness: 0.9,
              liquidity: 0.8,
              venueConfirmation: 1,
              priceOrOddsConfidence: 0.9,
              timingFit: 0.6,
              expectedEdge: 0.2,
              tradableNow: true,
              reason: "Direct venue-confirmed ZEC perp is cleaner than a literal pair that may not exist.",
              invalidation: ["ZEC beta invalidates the relative-value thesis."],
            },
          ],
          decision: "route_to_market_router",
          reason: "The direct asset is confirmed on a configured venue.",
          marketRouterInstructions: "Select the confirmed Hyperliquid ZEC-USDC perp if quotes remain liquid.",
        } as TradeExpressionPlan as T;
      },
    } as StructuredAiClient;

    const frame = await frameOpportunity({
      ai,
      sourcePost,
      userCommand: "what's the trade here?",
    });
    const result = await generateTradeExpressions({
      ai,
      sourcePost,
      userCommand: "what's the trade here?",
      opportunityFrame: frame,
      marketCandidates: [zecCandidate],
    });

    expect(result.rankedCandidates?.[0]).toMatchObject({
      rank: 1,
      symbol: "ZEC-USDC",
      expressionConfidence: 0.86,
    });
    expect(calls).toEqual([
      "cassie_opportunity_frame",
      "cassie_trade_expressions",
    ]);
  });

  it("validates ranked trade-expression candidates separately from expected edge", () => {
    const parsed = TradeExpressionPlanSchema.parse({
      signal: "ZEC thesis",
      coreInterpretation: "Direct ZEC is the clean expression.",
      directAsset: "ZEC",
      directAssetTradable: true,
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
      marketRouterInstructions: null,
    });

    expect(parsed.rankedCandidates?.[0]?.expressionConfidence).toBe(0.9);
    expect(parsed.rankedCandidates?.[0]?.expectedEdge).toBe(-0.1);
  });
});
