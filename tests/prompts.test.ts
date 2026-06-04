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
  polymarketSearchResultSelectionPrompt,
  polymarketSearchResultSelectionPromptSpec,
  renderPromptSpec,
  singleStepTradeExpressionPrompt,
  singleStepTradeExpressionPromptSpec,
  sourceModeClassificationPrompt,
  sourceModeClassificationPromptSpec,
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
  expressionFamilies: ["long SUI perp", "no trade if no matching configured venue market is found"],
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
      sourceModeClassificationPrompt({ sourcePost, userCommand: "@cassiedottrade trade this" }),
      opportunityFramePrompt({ sourcePost, userCommand: "@cassiedottrade trade this" }),
      singleStepTradeExpressionPrompt({
        sourcePost,
        userCommand: "@cassiedottrade trade this",
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
      polymarketSearchResultSelectionPrompt({
        thesis,
        tradeExpression,
        markets: [{
          slug: "microstrategy-sells-any-bitcoin-by-december-31-2026",
          question: "MicroStrategy sells any Bitcoin by December 31, 2026?",
          active: true,
          closed: false,
        }],
        limit: 5,
      }),
    ];

    for (const prompt of prompts) {
      expect(prompt).not.toContain("Return JSON");
      expect(prompt).not.toContain("provided schema");
      expect(prompt).not.toContain("Output valid JSON only");
    }

    expect(prompts.join("\n")).toContain("Do not invent tickers");
    expect(prompts.join("\n")).not.toContain("Stage role:");
    expect(prompts.join("\n")).not.toContain("Output contract:");
    expect(prompts.join("\n")).not.toContain("Reason privately in this order:");
    expect(prompts.join("\n")).not.toContain("Uncertainty handling:");
    expect(prompts.join("\n").match(/Role:/g)?.length).toBeGreaterThanOrEqual(6);
    expect(prompts.join("\n").match(/When uncertain:/g)?.length).toBeGreaterThanOrEqual(6);
    expect(prompts.join("\n").match(/Examples:/g)?.length).toBeGreaterThanOrEqual(6);
    expect(prompts.join("\n").match(/Before returning, verify internally:/g)?.length).toBeGreaterThanOrEqual(6);
    expect(prompts.join("\n")).toContain("Determine sourceMode from the source content only");
    expect(prompts.join("\n")).toContain("Consider all asset classes");
    expect(prompts.join("\n")).toContain("public equities, ETFs, commodities, FX, rates, bonds/credit, futures, options/volatility");
    expect(prompts.join("\n")).toContain("Only configured venues can produce executable candidates");
    expect(prompts.join("\n")).toContain("options and volatility instruments");
    expect(prompts.join("\n")).toContain("Generate candidateExpressions first");
    expect(prompts.join("\n")).toContain("Do not assume a real market exists");
    expect(prompts.join("\n")).toContain("Do not use no_trade when a non-no_trade candidateExpression still needs venue discovery");
    expect(prompts.join("\n")).toContain("HIP-3 pre-stock/private-company valuation perps");
    expect(prompts.join("\n")).toContain("thesis resolves to yes or no by a specific date");
    expect(prompts.join("\n")).toContain("intendedSide must be the side that would resolve true if the source claim is true");
    expect(prompts.join("\n")).toContain("do not generate intendedSide no merely because the report might be overstated");
    expect(prompts.join("\n")).toContain("additive to the price expression");
    expect(prompts.join("\n")).toContain("Cheap odds are not a fit defect");
    expect(prompts.join("\n")).toContain("Fed will cut rates at the June FOMC meeting");
    expect(prompts.join("\n")).toContain("selectedMarket is one of the supplied candidates");
    expect(prompts.join("\n")).toContain("Prefer Hyperliquid perps over Hyperliquid spot");
    expect(polymarketDiscoveryQueryPrompt({
      thesis,
      tradeExpression,
      limit: 5,
    })).toContain("Return an empty query list when the framed expression has no date-bounded yes/no event");
    expect(polymarketSearchResultSelectionPrompt({
      thesis,
      tradeExpression,
      markets: [],
      limit: 5,
    })).toContain("Select only supplied market slugs");
  });

  it("exposes stage prompts as AI SDK-ready specs", () => {
    const specs = [
      sourceModeClassificationPromptSpec({ sourcePost, userCommand: "@cassiedottrade trade this" }),
      opportunityFramePromptSpec({ sourcePost, userCommand: "@cassiedottrade trade this" }),
      singleStepTradeExpressionPromptSpec({
        sourcePost,
        userCommand: "@cassiedottrade trade this",
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
      polymarketSearchResultSelectionPromptSpec({
        thesis,
        tradeExpression,
        markets: [],
        limit: 5,
      }),
    ];

    expect(specs.map((spec) => spec.name)).toEqual([
      "cassie_source_mode_classification",
      "cassie_opportunity_frame",
      "cassie_trade_expressions",
      "cassie_expression_fit",
      "cassie_market_selection",
      "cassie_polymarket_discovery_queries",
      "cassie_polymarket_search_result_selection",
    ]);
    expect(specs.map((spec) => spec.version)).toEqual([
      "2026-05-31",
      "2026-05-31",
      "2026-05-31",
      "2026-05-31",
      "2026-05-31",
      "2026-05-31",
      "2026-05-31",
    ]);
    expect(specs.every((spec) => spec.outputSchema)).toBe(true);
    expect(specs.every((spec) => spec.system.includes("tagged-tweet trading research agent"))).toBe(true);
    expect(specs.every((spec) => spec.messages.length === 1)).toBe(true);
    expect(specs.every((spec) => spec.messages[0]?.role === "user")).toBe(true);
    expect(specs[0]?.system).toContain("Web search is available in this stage.");
    expect(specs[1]?.system).toContain("Web search is available in this stage.");
    for (const spec of specs.slice(2)) {
      expect(spec.system).not.toContain("Web search is available in this stage.");
    }
    expect(sourceModeClassificationPromptSpec({ sourcePost, userCommand: "@cassiedottrade urgent trade this" }).tools).toEqual({
      webSearch: {
        externalWebAccess: true,
        searchContextSize: "low",
      },
    });
    expect(opportunityFramePromptSpec({ sourcePost, userCommand: "@cassiedottrade trade this" }).tools).toEqual({
      webSearch: {
        externalWebAccess: true,
        searchContextSize: "low",
      },
    });
    const opportunityPayload = JSON.parse(String(opportunityFramePromptSpec({
      sourcePost,
      userCommand: "@cassiedottrade trade this",
    }).messages[0]?.content));
    expect(opportunityPayload.source).toMatchObject({
      text: sourcePost.text,
      author: "example",
    });
    expect(opportunityPayload.source).not.toHaveProperty("url");
    expect(opportunityPayload.source).not.toHaveProperty("created_at");
    expect(opportunityPayload.source).not.toHaveProperty("linked_urls");
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
      userCommand: "@cassiedottrade trade this",
      opportunityFrame,
    });
    const rendered = renderPromptSpec(spec);
    const legacy = singleStepTradeExpressionPrompt({
      sourcePost,
      userCommand: "@cassiedottrade trade this",
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
    const promptSpec = marketSelectionPromptSpec({
      thesis,
      tradeExpression: verboseTradeExpression,
      candidates: [marketCandidate],
      fitAssessments: [],
      quotes: [marketCandidate],
    });
    const prompt = renderPromptSpec(promptSpec);
    const payload = JSON.parse(String(promptSpec.messages[0]?.content));

    expect(prompt).not.toContain("\"rankedCandidates\"");
    expect(payload.tradeExpression).not.toHaveProperty("signal");
    expect(payload.tradeExpression).not.toHaveProperty("reason");
    expect(payload.tradeExpression).not.toHaveProperty("directAssetTradable");
    expect(payload.tradeExpression).not.toHaveProperty("marketDiscoveryConfidence");
    expect(payload.tradeExpression).not.toHaveProperty("publicMarketReadThrough");
    expect(payload.tradeExpression).not.toHaveProperty("insufficiency");
    expect(payload.tradeExpression).not.toHaveProperty("noTradeCase");
    expect(payload.tradeExpression.abstractExpressions[0]).not.toHaveProperty("abstractMarket");
    expect(payload.tradeExpression.abstractExpressions[0]).not.toHaveProperty("relatedEntities");
    expect(payload.tradeExpression.abstractExpressions[0]).not.toHaveProperty("whatMustBeTrue");
    expect(payload.tradeExpression.abstractExpressions[0]).not.toHaveProperty("keyRisks");
    expect(payload.tradeExpression.abstractExpressions[0]).not.toHaveProperty("expectedTimeHorizon");
    expect(prompt).not.toContain("Verbose candidate text that should not be duplicated in ranking input.");
    expect(prompt).not.toContain("Abstract rank that should not be mistaken for final market selection.");
    expect(prompt).toContain("\"abstractExpressions\"");
    expect(prompt).toContain("\"expressionId\": \"btc_short\"");
  });

  it("uses a slim fit-focused trade-expression payload for market assessment", () => {
    const prompt = expressionFitPrompt({
      opportunityFrame,
      tradeExpression: {
        ...tradeExpression,
        signal: "bullish duplicated direction",
        reason: "Verbose stage summary that should not be sent to fit assessment.",
        directAssetTradable: true,
        marketDiscoveryConfidence: 0.4,
        publicMarketReadThrough: "moderate",
        insufficiency: {
          score: 0.4,
          requiredThreshold: 0.7,
          failedDimensions: ["market_discovery"],
          summary: "Discovery is incomplete.",
          evidenceNeededToClear: ["Find a venue market"],
        },
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
      },
      candidate: marketCandidate,
    });

    expect(prompt).not.toContain("bullish duplicated direction");
    expect(prompt).not.toContain("Verbose stage summary that should not be sent to fit assessment.");
    expect(prompt).not.toContain("\"directAssetTradable\"");
    expect(prompt).not.toContain("\"marketDiscoveryConfidence\"");
    expect(prompt).not.toContain("\"publicMarketReadThrough\"");
    expect(prompt).not.toContain("\"insufficiency\"");
    expect(prompt).not.toContain("\"abstractMarket\"");
    expect(prompt).not.toContain("\"relatedEntities\"");
    expect(prompt).not.toContain("\"whatMustBeTrue\"");
    expect(prompt).not.toContain("\"keyRisks\"");
    expect(prompt).not.toContain("\"expectedTimeHorizon\"");
    expect(prompt).toContain("\"thesis\": \"BTC short if the market reads through Strategy sale pressure.\"");
    expect(prompt).toContain("\"requiredMarketFeatures\"");
  });
});
