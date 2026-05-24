import { describe, expect, it } from "vitest";
import {
  expressionFitPrompt,
  marketSelectionPrompt,
  opportunityFramePrompt,
  polymarketDiscoveryQueryPrompt,
  singleStepTradeExpressionPrompt,
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
  });
});
