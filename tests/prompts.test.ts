import { describe, expect, it } from "vitest";
import {
  expressionFitPrompt,
  expressionFitPromptSpec,
  marketSelectionPrompt,
  marketSelectionPromptSpec,
  opportunityFramePrompt,
  opportunityFramePromptSpec,
  polymarketDiscoveryQueryPrompt,
  polymarketDiscoveryQueryPromptSpec,
  renderPromptSpec,
  singleStepTradeExpressionPrompt,
  singleStepTradeExpressionPromptSpec,
  structuredPromptInput,
} from "../packages/prompts/index.ts";
import type {
  MarketCandidate,
  OpportunityFrame,
  SourcePost,
  Thesis,
  TradeExpressionPlan,
} from "../packages/core/schemas/index.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "post_1",
  url: "https://x.com/example/status/post_1",
  authorHandle: "example",
  authorName: "Example",
  text: "Sui says stablecoin transfers are live and free on mainnet.",
  createdAt: "2026-05-24T00:00:00.000Z",
  quotedPostText: null,
  linkedUrls: [],
  mediaDescriptions: [],
};

const opportunityFrame: OpportunityFrame = {
  literalClaim: "Sui says stablecoin transfers are live and free on mainnet.",
  opportunity: "Reduced transfer friction could increase Sui usage.",
  marketImplication: "Potential bullish SUI read-through if activity increases.",
  userIntent: "trade",
  affectedEntities: ["Sui"],
  affectedAssets: ["SUI"],
  expressionFamilies: ["long SUI perp", "no trade if already priced"],
  signalVerificationRisk: "medium",
  shouldVerifyTruthBeforeTrading: true,
  reason: "Network usage impact is indirect and needs venue validation.",
  confidence: 0.68,
};

const thesis: Thesis = {
  claim: "Sui stablecoin transfers are live and free.",
  direction: "bullish",
  mentionedAssets: ["SUI"],
  topics: ["stablecoins", "Sui"],
  timeHorizon: "event_based",
  evidenceQuality: "medium",
  manipulationRisk: "medium",
  confidence: 0.68,
};

const tradeExpression: TradeExpressionPlan = {
  signal: "Free stablecoin transfers on Sui",
  coreInterpretation: "Lower transfer friction may increase Sui network activity.",
  directAsset: "SUI",
  directAssetTradable: true,
  evidenceConfidence: 0.68,
  marketDiscoveryConfidence: 0.4,
  tradeExpressionConfidence: 0.62,
  highestPurityExpression: "Long SUI spot/perp if a real liquid venue validates the expression.",
  publicMarketReadThrough: "moderate",
  candidates: [],
  rankedCandidates: [],
  candidateExpressions: [],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "needs_market_check",
  reason: "Needs venue confirmation.",
  insufficiency: null,
  marketRouterInstructions: "Search configured crypto venues for SUI.",
};

const marketCandidate: MarketCandidate = {
  venue: "hyperliquid",
  instrument: "perp",
  side: "long",
  symbol: "SUI",
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
  markPrice: 3,
  liquidityScore: 0.8,
  spreadBps: 5,
  estimatedSlippageBps: 3,
  minOrderSizeUsd: 10,
  thesisFit: 0.75,
  reason: "Direct SUI perp candidate.",
};

describe("prompts", () => {
  it("keeps semantic rules but removes AI SDK structured-output prose", () => {
    const prompts = [
      opportunityFramePrompt({ sourcePost, userCommand: "@cassie trade this" }),
      singleStepTradeExpressionPrompt({
        sourcePost,
        userCommand: "@cassie trade this",
        opportunityFrame,
      }),
      expressionFitPrompt({
        opportunityFrame,
        tradeExpression,
        candidate: marketCandidate,
      }),
      marketSelectionPrompt({
        thesis,
        tradeExpression,
        candidates: [marketCandidate],
        fitAssessments: [],
        quotes: [marketCandidate],
      }),
      polymarketDiscoveryQueryPrompt({
        thesis,
        tradeExpression,
        limit: 5,
      }),
    ];

    for (const prompt of prompts) {
      expect(prompt).not.toContain("Return JSON");
      expect(prompt).not.toContain("provided schema");
      expect(prompt).not.toContain("Output valid JSON only");
    }

    expect(prompts.join("\n")).toContain("Do not invent tickers");
    expect(prompts.join("\n")).toContain("Generate candidateExpressions first");
    expect(prompts.join("\n")).toContain("Do not assume a real market exists");
    expect(prompts.join("\n")).toContain("Do not use no_trade when a non-no_trade candidateExpression still needs venue discovery");
    expect(polymarketDiscoveryQueryPrompt({
      thesis,
      tradeExpression,
      limit: 5,
    })).toContain("exact, entity-adjacent, asset-adjacent, and narrative-adjacent");
  });

  it("exposes stage prompts as AI SDK-ready specs", () => {
    const specs = [
      opportunityFramePromptSpec({ sourcePost, userCommand: "@cassie trade this" }),
      singleStepTradeExpressionPromptSpec({
        sourcePost,
        userCommand: "@cassie trade this",
        opportunityFrame,
      }),
      expressionFitPromptSpec({
        opportunityFrame,
        tradeExpression,
        candidate: marketCandidate,
      }),
      marketSelectionPromptSpec({
        thesis,
        tradeExpression,
        candidates: [marketCandidate],
        fitAssessments: [],
        quotes: [marketCandidate],
      }),
      polymarketDiscoveryQueryPromptSpec({
        thesis,
        tradeExpression,
        limit: 5,
      }),
    ];

    expect(specs.map((spec) => spec.name)).toEqual([
      "cassie_opportunity_frame",
      "cassie_trade_expressions",
      "cassie_expression_fit",
      "cassie_market_selection",
      "cassie_polymarket_discovery_queries",
    ]);
    expect(specs.map((spec) => spec.version)).toEqual([
      "2026-05-24",
      "2026-05-24",
      "2026-05-24",
      "2026-05-24",
      "2026-05-24",
    ]);
    expect(specs.every((spec) => spec.outputSchema)).toBe(true);
    expect(specs.every((spec) => spec.system.includes("tagged-tweet trading research agent"))).toBe(true);
    expect(specs.every((spec) => spec.messages.length === 1)).toBe(true);
    expect(specs.every((spec) => spec.messages[0]?.role === "user")).toBe(true);
    expect(specs[0]?.system).toContain("Web search is available in this stage.");
    for (const spec of specs.slice(1)) {
      expect(spec.system).not.toContain("Web search is available in this stage.");
    }
    expect(opportunityFramePromptSpec({ sourcePost, userCommand: "@cassie trade this" }).tools).toEqual({
      webSearch: {
        externalWebAccess: true,
        searchContextSize: "low",
      },
    });
    expect(JSON.parse(String(opportunityFramePromptSpec({
      sourcePost,
      userCommand: "@cassie trade this",
    }).messages[0]?.content)).source).toMatchObject({
      author: "Example",
    });
    expect(marketSelectionPromptSpec({
      thesis,
      tradeExpression,
      candidates: [marketCandidate],
      fitAssessments: [],
      quotes: [marketCandidate],
    }).tier).toBe("cheap");
  });

  it("keeps legacy string prompts rendered from the prompt spec content", () => {
    const spec = singleStepTradeExpressionPromptSpec({
      sourcePost,
      userCommand: "@cassie trade this",
      opportunityFrame,
    });
    const rendered = renderPromptSpec(spec);
    const legacy = singleStepTradeExpressionPrompt({
      sourcePost,
      userCommand: "@cassie trade this",
      opportunityFrame,
    });

    expect(legacy).toBe(rendered);
    expect(structuredPromptInput(spec)).toMatchObject({
      name: "cassie_trade_expressions",
      prompt: rendered,
      system: spec.system,
      messages: spec.messages,
      schema: spec.outputSchema,
    });
  });

  it("uses a slim rank-focused trade-expression payload for market selection", () => {
    const verboseTradeExpression: TradeExpressionPlan = {
      ...tradeExpression,
      candidates: [{
        instrument: "BTC perp",
        venue: "hyperliquid",
        symbol: "BTC",
        instrumentType: "perp",
        venueQuery: "BTC perp",
        expression: "short",
        thesis: "Verbose candidate text that should not be duplicated in ranking input.",
        venueChecks: ["Check BTC perp"],
        currentMarketPriceOrOdds: null,
        fairValueOrExpectedValue: null,
        causalDirectness: 0.5,
        liquidity: 0.9,
        surprise: 0.4,
        timing: 0.6,
        crowdingRisk: 0.4,
        downsideAsymmetry: 0.4,
        evidenceQuality: 0.6,
        expectedEdge: 0.2,
        tradableNow: true,
        rejectionReason: null,
        invalidation: [],
        evidenceNeeded: [],
      }],
      rankedCandidates: [{
        rank: 1,
        candidateId: "abstract_btc_short",
        venue: "hyperliquid",
        symbol: "BTC",
        side: "short",
        expressionConfidence: 0.5,
        thesisFit: 0.5,
        causalDirectness: 0.5,
        liquidity: 0.9,
        venueConfirmation: 0.5,
        priceOrOddsConfidence: 0.2,
        timingFit: 0.5,
        expectedEdge: 0.2,
        tradableNow: true,
        reason: "Abstract rank that should not be mistaken for final market selection.",
        invalidation: [],
      }],
      candidateExpressions: [{
        expressionId: "btc_short",
        expressionRail: "crypto",
        expressionType: "directional",
        abstractMarket: "BTC price",
        intendedSide: "short",
        primaryEntityOrEvent: "Bitcoin",
        relatedEntities: ["Strategy"],
        thesis: "BTC short if the market reads through Strategy sale pressure.",
        whyThisExpressesTheOpportunity: "It expresses the BTC price read-through.",
        directness: "strong_proxy",
        whatMustBeTrue: ["Market reacts to Strategy sale pressure"],
        searchTerms: ["BTC perp"],
        requiredMarketFeatures: ["Liquid BTC perp"],
        requiredRuleOrContractFeatures: [],
        keyRisks: ["Weak proxy"],
        expectedTimeHorizon: "hours",
        priority: "medium",
        confidence: 0.54,
      }],
    };
    const prompt = marketSelectionPrompt({
      thesis,
      tradeExpression: verboseTradeExpression,
      candidates: [marketCandidate],
      fitAssessments: [],
      quotes: [marketCandidate],
    });

    expect(prompt).not.toContain("\"rankedCandidates\"");
    expect(prompt).not.toContain("Verbose candidate text that should not be duplicated in ranking input.");
    expect(prompt).not.toContain("Abstract rank that should not be mistaken for final market selection.");
    expect(prompt).toContain("\"abstractExpressions\"");
    expect(prompt).toContain("\"expressionId\": \"btc_short\"");
  });
});
