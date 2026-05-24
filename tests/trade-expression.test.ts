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
  quotedPostText: null,
  linkedUrls: [],
  mediaDescriptions: [],
};

const zecCandidate: MarketCandidate = {
  venue: "hyperliquid",
  instrument: "perp",
  side: "long",
  symbol: "ZEC-USDC",
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
  volumeUsd: null,
  liquidityUsd: null,
  endDate: null,
  warnings: [],
  markPrice: 643,
  liquidityScore: 0.8,
  spreadBps: 4,
  estimatedSlippageBps: 3,
  minOrderSizeUsd: 10,
  thesisFit: 0.86,
  reason: "Direct ZEC perp maps to the thesis asset.",
};

describe("trade expression planning", () => {
  it("runs AI-backed opportunity framing and expression generation with rewritten prompts", async () => {
    const calls: Array<{ name: string; prompt: string }> = [];
    const ai = {
      async generateObject<T>(input: { name: string; prompt: string }): Promise<T> {
        calls.push(input);
        const outputs: Record<string, unknown> = {
          cassie_opportunity_frame: {
            literalClaim: "ZEC relative to BTC could rerate.",
            opportunity: "The tweet implies ZEC may have underpriced relative upside.",
            marketImplication: "Potential bullish ZEC expression if a real liquid market exists.",
            userIntent: "trade",
            affectedEntities: ["Zcash"],
            affectedAssets: ["ZEC"],
            expressionFamilies: ["long ZEC perp", "no trade if edge is already priced"],
            signalVerificationRisk: "medium",
            shouldVerifyTruthBeforeTrading: true,
            reason: "The tweet is a thesis, not a venue-confirmed trade.",
            confidence: 0.62,
          },
          cassie_trade_expressions: {
            signal: "ZEC relative strength thesis",
            coreInterpretation: "ZEC may rerate if the market is underpricing privacy-coin demand.",
            directAsset: "ZEC",
            directAssetTradable: false,
            evidenceConfidence: 0.5,
            marketDiscoveryConfidence: 0.2,
            tradeExpressionConfidence: 0.55,
            highestPurityExpression: "Long ZEC if a real liquid venue validates the expression.",
            publicMarketReadThrough: "none",
            candidates: [],
            rankedCandidates: [],
            candidateExpressions: [{
              expressionId: "expr_zec_long",
              expressionRail: "crypto",
              expressionType: "directional",
              abstractMarket: "ZEC perp or spot",
              intendedSide: "long",
              primaryEntityOrEvent: "ZEC",
              relatedEntities: ["Zcash"],
              thesis: "ZEC rerates versus broader crypto if demand is underpriced.",
              whyThisExpressesTheOpportunity: "A direct ZEC market maps to the tweet's relative-value claim.",
              directness: "direct",
              whatMustBeTrue: ["A real ZEC market exists with acceptable liquidity."],
              searchTerms: ["ZEC", "Zcash"],
              requiredMarketFeatures: ["listed ZEC spot or perp"],
              requiredRuleOrContractFeatures: [],
              keyRisks: ["The thesis may already be priced."],
              expectedTimeHorizon: "weeks",
              priority: "high",
              confidence: 0.55,
            }],
            discardedExpressions: [],
            noTradeCase: {
              shouldConsiderNoTrade: true,
              reason: "No trade if no real venue validates ZEC exposure.",
              whatWouldChangeThis: ["A real liquid venue candidate with validated fit."],
            },
            decision: "needs_market_check",
            reason: "Venue confirmation is required before any trade.",
            insufficiency: null,
            marketRouterInstructions: "Search real venues for ZEC exposure.",
          },
        };
        return outputs[input.name] as T;
      },
    };

    await expect(frameOpportunity({
      ai,
      sourcePost,
      userCommand: "what's the trade here?",
    })).resolves.toMatchObject({
      opportunity: expect.stringContaining("ZEC"),
    });

    await expect(generateTradeExpressions({
      ai,
      sourcePost,
      userCommand: "what's the trade here?",
      marketCandidates: [zecCandidate],
    })).resolves.toMatchObject({
      candidateExpressions: [expect.objectContaining({ expressionRail: "crypto" })],
    });
    expect(calls.map((call) => call.name)).toEqual([
      "cassie_opportunity_frame",
      "cassie_trade_expressions",
    ]);
    expect(calls[1]?.prompt).toContain("Do not assume a real market exists");
    expect(calls[1]?.prompt).toContain("Do not invent tickers");
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
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
      decision: "no_trade",
      reason: "Expression is clean but expected edge is negative.",
      insufficiency: null,
      marketRouterInstructions: null,
    });

    expect(parsed.rankedCandidates?.[0]?.expressionConfidence).toBe(0.9);
    expect(parsed.rankedCandidates?.[0]?.expectedEdge).toBe(-0.1);
  });
});
