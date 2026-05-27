import { describe, expect, it, vi } from "vitest";
import { MissingConnectorConfigError } from "../packages/core/helpers/connector-errors.ts";
import {
  GrokXSentimentProvider,
  type GrokXSentimentGenerationInput,
  GrokXSourceResolutionError,
  GrokXSourceResolver,
  buildGrokXSentimentPrompt,
  buildGrokSourceResolutionPrompt,
  parseXStatusUrl,
} from "../packages/agent/source.ts";
import type {
  ExpressionFitAssessment,
  MarketCandidate,
  OpportunityFrame,
  TradeExpressionPlan,
} from "../packages/core/schemas/index.ts";

const opportunityFrame: OpportunityFrame = {
  literalClaim: "Ethereum Foundation researchers are resigning.",
  opportunity: "Potential bearish ETH headline risk if resignations are real and material.",
  marketImplication: "ETH sentiment may weaken if the claim is broadly believed.",
  userIntent: "trade",
  affectedEntities: ["Ethereum Foundation"],
  affectedAssets: ["ETH"],
  expressionFamilies: ["short ETH perp", "no trade if unverified"],
  signalVerificationRisk: "high",
  shouldVerifyTruthBeforeTrading: true,
  reason: "The source claim needs verification and may be stale or exaggerated.",
  confidence: 0.55,
};

const tradeExpression: TradeExpressionPlan = {
  signal: "Ethereum Foundation resignation headline",
  coreInterpretation: "Potential negative ETH sentiment.",
  directAsset: "ETH",
  directAssetTradable: true,
  evidenceConfidence: 0.55,
  marketDiscoveryConfidence: 0.8,
  tradeExpressionConfidence: 0.62,
  highestPurityExpression: "Short ETH perp if venue and quote validate.",
  publicMarketReadThrough: "moderate",
  candidates: [],
  rankedCandidates: [],
  candidateExpressions: [],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "needs_market_check",
  reason: "Needs venue, quote, and sentiment checks.",
  insufficiency: null,
  marketRouterInstructions: "Search ETH perp venues.",
};

const candidate: MarketCandidate = {
  venue: "hyperliquid",
  instrument: "perp",
  side: "short",
  symbol: "ETH",
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
  markPrice: 2500,
  liquidityScore: 0.9,
  spreadBps: 4,
  estimatedSlippageBps: 2,
  minOrderSizeUsd: 10,
  thesisFit: 0.78,
  reason: "Direct ETH perp candidate.",
};

const fitAssessment: ExpressionFitAssessment = {
  candidateId: "hyperliquid:ETH:short",
  expressionId: "expr_eth_short",
  expressionRail: "crypto",
  venue: "hyperliquid",
  fitStatus: "validated",
  intendedSide: "short",
  sideFit: "correct",
  directness: "direct",
  fitScore: 0.82,
  semanticFitSummary: "Short ETH directly expresses bearish ETH sentiment.",
  ruleOrContractFitSummary: "ETH perpetual gives direct directional exposure.",
  basisRisks: ["Broad market beta may dominate."],
  mismatchReasons: [],
  requiredFollowUp: [],
  confidence: 0.78,
};

describe("Grok X source resolver", () => {
  it("parses X and Twitter status URLs into canonical locators", () => {
    expect(parseXStatusUrl("https://x.com/example/status/2057246023974875269?s=20")).toEqual({
      handle: "example",
      postId: "2057246023974875269",
      canonicalUrl: "https://x.com/example/status/2057246023974875269",
    });
    expect(parseXStatusUrl("https://twitter.com/example/statuses/1234567890")).toEqual({
      handle: "example",
      postId: "1234567890",
      canonicalUrl: "https://x.com/example/status/1234567890",
    });
  });

  it("builds a prompt that requires exact post resolution without invention", () => {
    const prompt = buildGrokSourceResolutionPrompt({
      handle: "example",
      postId: "2057246023974875269",
      canonicalUrl: "https://x.com/example/status/2057246023974875269",
    });

    expect(prompt).toContain("https://x.com/example/status/2057246023974875269");
    expect(prompt).toContain("2057246023974875269");
    expect(prompt).toContain("Do not infer, summarize, embellish, or invent");
  });

  it("uses Grok X search to resolve a tweet and normalizes known locator fields", async () => {
    const generate = vi.fn(async () => ({
      found: true,
      reason: null,
      sourcePost: {
        platform: "x" as const,
        postId: null,
        url: null,
        authorHandle: null,
        authorName: "Example",
        text: "OpenAI revenue growth is accelerating ahead of a potential IPO.",
        createdAt: "2026-05-24T00:00:00.000Z",
        quotedPostText: null,
        linkedUrls: ["https://example.com/source"],
        mediaDescriptions: ["Chart showing revenue acceleration."],
      },
    }));

    const source = await new GrokXSourceResolver("xai-key", "grok-test", undefined, generate)
      .resolveSource({ url: "https://x.com/example/status/2057246023974875269" });

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "xai-key",
      model: "grok-test",
      locator: {
        handle: "example",
        postId: "2057246023974875269",
        canonicalUrl: "https://x.com/example/status/2057246023974875269",
      },
    }));
    expect(source).toMatchObject({
      platform: "x",
      postId: "2057246023974875269",
      url: "https://x.com/example/status/2057246023974875269",
      authorHandle: "example",
      authorName: "Example",
      text: "OpenAI revenue growth is accelerating ahead of a potential IPO.",
      createdAt: "2026-05-24T00:00:00.000Z",
      quotedPostText: null,
      linkedUrls: ["https://example.com/source"],
      mediaDescriptions: ["Chart showing revenue acceleration."],
    });
  });

  it("surfaces missing XAI configuration", async () => {
    await expect(new GrokXSourceResolver(undefined).resolveSource({
      url: "https://x.com/example/status/2057246023974875269",
    })).rejects.toBeInstanceOf(MissingConnectorConfigError);
  });

  it("fails when Grok cannot resolve the exact post", async () => {
    const generate = vi.fn(async () => ({
      found: false,
      reason: "The exact status was not available to X search.",
      sourcePost: null,
    }));

    await expect(new GrokXSourceResolver("xai-key", "grok-test", undefined, generate)
      .resolveSource({ url: "https://x.com/example/status/2057246023974875269" }))
      .rejects.toThrow(GrokXSourceResolutionError);
  });

  it("builds an X sentiment prompt that is X-only and forbids invention", () => {
    const prompt = buildGrokXSentimentPrompt({
      sourcePost: {
        platform: "x",
        postId: "2057246023974875269",
        url: "https://x.com/example/status/2057246023974875269",
        authorHandle: "example",
        authorName: "Example",
        text: "Ethereum Foundation researchers are resigning.",
        createdAt: "2026-05-24T00:00:00.000Z",
        quotedPostText: null,
        linkedUrls: [],
        mediaDescriptions: [],
      },
      opportunityFrame,
      tradeExpression,
      fitAssessment,
      candidate,
    });

    expect(prompt).toContain("Use the x_search tool. Do not use generic web search.");
    expect(prompt).toContain("Use authorName, not handles.");
    expect(prompt).toContain("Do not invent posts, authors, timestamps");
  });

  it("uses Grok X search for sentiment and records model thinking traces", async () => {
    const generate = vi.fn(async (input: GrokXSentimentGenerationInput) => {
      input.onThinkingTrace?.("Grok searched X for sentiment.");
      return {
        status: "available" as const,
        sourcesChecked: ["x" as const],
        sentimentDirection: "bearish" as const,
        attentionLevel: "medium" as const,
        novelty: "already_widespread" as const,
        crowdingRisk: "medium" as const,
        correctionRisk: "high" as const,
        summary: "X discussion is bearish but includes credible corrections.",
        evidence: [{
          url: "https://x.com/researcher/status/1",
          authorName: "Researcher",
          text: "The resignation claim is missing context.",
          observedAt: "2026-05-24T00:01:00.000Z",
          relevance: "Credible correction risk for the source claim.",
        }],
        limitations: ["X search visibility may be incomplete."],
      };
    });
    const traces: Array<string | null> = [];

    const sentiment = await new GrokXSentimentProvider("xai-key", "grok-test", undefined, generate)
      .checkXSentiment({
        sourcePost: {
          platform: "x",
          postId: "2057246023974875269",
          url: "https://x.com/example/status/2057246023974875269",
          authorHandle: "example",
          authorName: "Example",
          text: "Ethereum Foundation researchers are resigning.",
          createdAt: "2026-05-24T00:00:00.000Z",
          quotedPostText: null,
          linkedUrls: [],
          mediaDescriptions: [],
        },
        opportunityFrame,
        tradeExpression,
        fitAssessment,
        candidate,
        onThinkingTrace: (trace) => traces.push(trace),
      });

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "xai-key",
      model: "grok-test",
      opportunityFrame,
      tradeExpression,
      fitAssessment,
      candidate,
    }));
    expect(sentiment).toMatchObject({
      status: "available",
      sentimentDirection: "bearish",
      correctionRisk: "high",
    });
    expect(traces).toEqual(["Grok searched X for sentiment."]);
  });
});
