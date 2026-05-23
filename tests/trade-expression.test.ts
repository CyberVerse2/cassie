import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { planTradeExpression } from "../packages/agent/tools/trade-expression.ts";
import type {
  MarketCandidate,
  SignalInterpretation,
  SourcePost,
  Thesis,
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

const signal: SignalInterpretation = {
  signalType: "generic_opinion",
  containsExplicitThesis: true,
  impliedTheses: ["ZEC may rerate relative to BTC."],
  affectedEntities: ["Zcash"],
  affectedSectors: ["crypto"],
  summary: "ZEC may rerate relative to BTC.",
  directTradability: "direct",
  suggestedResearchAngles: ["Check direct ZEC markets."],
  leadQuality: "trade_candidate",
  confidence: 0.7,
};

const thesis: Thesis = {
  claim: "ZEC could rerate higher relative to BTC.",
  direction: "bullish",
  mentionedAssets: ["ZEC"],
  topics: ["Zcash", "relative value"],
  timeHorizon: "event_based",
  evidenceQuality: "medium",
  manipulationRisk: "medium",
  confidence: 0.7,
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
  it("runs a bounded tool loop that can search markets before finishing a ranked expression", async () => {
    const calls: string[] = [];
    const ai = {
      async generateObject<T>(input: { name: string; prompt: string }): Promise<T> {
        calls.push(input.name);
        if (input.name === "cassie_trade_expression_step" && calls.length === 1) {
          expect(input.prompt).toContain("search_hyperliquid");
          return {
            action: "search_hyperliquid",
            reason: "Need direct venue confirmation for ZEC.",
            search: {
              assets: ["ZEC"],
              queries: ["ZEC perp", "ZEC-USDC"],
            },
          } as T;
        }

        expect(input.name).toBe("cassie_trade_expression_step");
        expect(input.prompt).toContain("ZEC-USDC");
        return {
          action: "finish_trade_expression",
          reason: "Direct ZEC market is confirmed.",
          final: {
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
          } satisfies TradeExpressionPlan,
        } as T;
      },
    } as StructuredAiClient;

    const result = await planTradeExpression({
      ai,
      marketData: {
        async findCandidates(input) {
          expect(input.thesis.claim).toContain(sourcePost.text);
          return [zecCandidate];
        },
      },
      sourcePost,
      userCommand: "what's the trade here?",
    });

    expect(result.rankedCandidates?.[0]).toMatchObject({
      rank: 1,
      symbol: "ZEC-USDC",
      expressionConfidence: 0.86,
    });
    expect(calls).toEqual([
      "cassie_trade_expression_step",
      "cassie_trade_expression_step",
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
