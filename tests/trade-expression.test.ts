import { describe, expect, it } from "vitest";
import {
  frameOpportunity,
  generateTradeExpressions,
} from "../packages/agent/tools.ts";
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
      async generateObject<T>(input: {
        name: string;
        prompt: string;
      }): Promise<T> {
        calls.push(input);
        const outputs: Record<string, unknown> = {
          cassie_opportunity_frame: {
            literalClaim: "ZEC relative to BTC could rerate.",
            opportunity:
              "The tweet implies ZEC may have underpriced relative upside.",
            marketImplication:
              "Potential bullish ZEC expression if a real liquid market exists.",
            userIntent: "trade",
            affectedEntities: ["Zcash"],
            affectedAssets: ["ZEC"],
            expressionFamilies: [
              "long ZEC perp",
              "no trade if no matching configured venue market is found",
            ],
            signalVerificationRisk: "medium",
            shouldVerifyTruthBeforeTrading: true,
            reason: "The tweet is a thesis, not a venue-confirmed trade.",
            confidence: 0.62,
          },
          cassie_trade_expressions: {
            signal: "ZEC relative strength thesis",
            coreInterpretation:
              "ZEC may rerate if the market is underpricing privacy-coin demand.",
            directAsset: "ZEC",
            directAssetTradable: false,
            evidenceConfidence: 0.5,
            marketDiscoveryConfidence: 0.2,
            tradeExpressionConfidence: 0.55,
            highestPurityExpression:
              "Long ZEC if a real liquid venue validates the expression.",
            publicMarketReadThrough: "none",
            candidateExpressions: [
              {
                expressionId: "expr_zec_long",
                expressionRail: "crypto",
                expressionType: "directional",
                abstractMarket: "ZEC perp or spot",
                intendedSide: "long",
                primaryEntityOrEvent: "ZEC",
                thesis:
                  "ZEC rerates versus broader crypto if demand is underpriced.",
                directness: "direct",
                whatMustBeTrue: [
                  "A real ZEC market exists with acceptable liquidity.",
                ],
                searchTerms: ["ZEC", "Zcash"],
                requiredMarketFeatures: ["listed ZEC spot or perp"],
                requiredRuleOrContractFeatures: [],
                expectedTimeHorizon: "weeks",
                priority: "high",
                confidence: 0.55,
              },
            ],
            discardedExpressions: [],
            noTradeCase: {
              shouldConsiderNoTrade: true,
              reason: "No trade if no real venue validates ZEC exposure.",
              whatWouldChangeThis: [
                "A real liquid venue candidate with validated fit.",
              ],
            },
            decision: "needs_market_check",
            reason: "Venue confirmation is required before any trade.",
            insufficiency: null,
            marketDiscovery: {
              status: "needed",
              venues: ["hyperliquid"],
              missing: ["market_discovery"],
              instructions: "Search real venues for ZEC exposure.",
              queries: [],
            },
          },
        };
        return outputs[input.name] as T;
      },
    };

    await expect(
      frameOpportunity({
        ai,
        sourcePost,
        userCommand: "what's the trade here?",
      }),
    ).resolves.toMatchObject({
      opportunity: expect.stringContaining("ZEC"),
    });

    await expect(
      generateTradeExpressions({
        ai,
        sourcePost,
        userCommand: "what's the trade here?",
        marketCandidates: [zecCandidate],
      }),
    ).resolves.toMatchObject({
      candidateExpressions: [
        expect.objectContaining({ expressionRail: "crypto" }),
      ],
    });
    expect(calls.map((call) => call.name)).toEqual([
      "cassie_opportunity_frame",
      "cassie_trade_expressions",
    ]);
    expect(calls[1]?.prompt).toContain("Do not assume a real market exists");
    expect(calls[1]?.prompt).toContain("Do not invent tickers");
  });

  it("strips legacy ranked trade-expression candidates", () => {
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
      candidateExpressions: [],
      discardedExpressions: [],
      noTradeCase: null,
      decision: "no_trade",
      reason: "Expression is clean but expected edge is negative.",
      insufficiency: null,
      marketDiscovery: null,
      rankedCandidates: [{ expressionConfidence: 0.9, expectedEdge: -0.1 }],
    });

    expect(parsed).not.toHaveProperty("rankedCandidates");
  });

  it("keeps plausible unverified expressions in market-check mode", async () => {
    const ai = {
      async generateObject<T>(): Promise<T> {
        return {
          signal: "Private AI infrastructure traction.",
          coreInterpretation:
            "The tweet is a soft positive private-market signal.",
          directAsset: "turbopuffer",
          directAssetTradable: false,
          evidenceConfidence: 0.61,
          marketDiscoveryConfidence: 0.14,
          tradeExpressionConfidence: 0.19,
          highestPurityExpression: "no_trade",
          publicMarketReadThrough: "weak",
          candidateExpressions: [
            {
              expressionId: "turbopuffer_private_long",
              expressionRail: "pre_ipo",
              expressionType: "directional",
              abstractMarket: "turbopuffer private-company valuation exposure",
              intendedSide: "long",
              primaryEntityOrEvent: "turbopuffer",
              thesis:
                "Customer-validation signal could support turbopuffer valuation if a real private-market instrument exists.",
              directness: "direct",
              searchTerms: [
                "turbopuffer pre-IPO",
                "turbopuffer private market",
              ],
              requiredMarketFeatures: ["Configured private-company listing"],
              requiredRuleOrContractFeatures: [
                "Direct exposure to turbopuffer valuation",
              ],
              expectedTimeHorizon: "weeks",
              priority: "medium",
              confidence: 0.24,
            },
          ],
          discardedExpressions: [],
          noTradeCase: {
            shouldConsiderNoTrade: true,
            reason: "No trade if venue search finds no real listing.",
            whatWouldChangeThis: ["Confirmed private-market listing."],
          },
          decision: "no_trade",
          reason: "No confirmed venue yet.",
          insufficiency: {
            score: 0.24,
            requiredThreshold: 0.7,
            failedDimensions: ["market_discovery", "venue_confirmation"],
            summary: "Venue discovery is missing.",
            evidenceNeededToClear: ["Confirmed configured-venue listing."],
          },
          marketDiscovery: null,
        } as T;
      },
    };

    await expect(
      generateTradeExpressions({
        ai,
        sourcePost,
        userCommand: "@Cassie trade this",
      }),
    ).resolves.toMatchObject({
      decision: "needs_market_check",
      marketDiscovery: expect.objectContaining({
        instructions: expect.stringContaining("Search configured venues"),
      }),
    });
  });

  it("does not turn unsupported execution rails into venue-search work", async () => {
    const ai = {
      async generateObject<T>(): Promise<T> {
        return {
          signal: "Volatility should expand after a macro catalyst.",
          coreInterpretation:
            "The clean expression is a listed volatility option, which Cassie cannot execute yet.",
          directAsset: "VIX",
          directAssetTradable: false,
          evidenceConfidence: 0.66,
          marketDiscoveryConfidence: 0.1,
          tradeExpressionConfidence: 0.28,
          highestPurityExpression:
            "Long volatility option, unsupported by configured venues.",
          publicMarketReadThrough: "strong",
          candidateExpressions: [
            {
              expressionId: "vix_volatility_option",
              expressionRail: "options_volatility",
              expressionType: "directional",
              abstractMarket: "VIX call option",
              intendedSide: "long",
              primaryEntityOrEvent: "VIX",
              thesis: "Long volatility expresses the thesis directly.",
              directness: "direct",
              searchTerms: ["VIX call"],
              requiredMarketFeatures: ["listed option"],
              requiredRuleOrContractFeatures: ["option contract"],
              expectedTimeHorizon: "days",
              priority: "high",
              confidence: 0.28,
            },
          ],
          discardedExpressions: [],
          noTradeCase: {
            shouldConsiderNoTrade: true,
            reason: "No configured options venue exists.",
            whatWouldChangeThis: ["Configured options execution support."],
          },
          decision: "no_trade",
          reason: "The clean rail is unsupported.",
          insufficiency: null,
          marketDiscovery: null,
        } as T;
      },
    };

    await expect(
      generateTradeExpressions({
        ai,
        sourcePost,
        userCommand: "@Cassie trade this",
      }),
    ).resolves.toMatchObject({
      decision: "no_trade",
    });
  });
});
