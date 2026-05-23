import type { StructuredAiClient } from "../../ai/client.ts";
import { z } from "zod";
import { tradeExpressionLoopPrompt } from "../../prompts/index.ts";
import {
  MarketCandidateSchema,
  TradeExpressionPlanSchema,
  type MarketCandidate,
  type SourcePost,
  type Thesis,
  type TradeExpressionPlan,
} from "../../core/schemas/index.ts";
import type { MarketDataProvider, PolymarketMarketFinder } from "./market.ts";

const MarketSearchSchema = z.object({
  assets: z.array(z.string()).default([]),
  queries: z.array(z.string()).default([]),
});

const TradeExpressionLoopActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("resolve_asset_mapping"),
    reason: z.string(),
    search: MarketSearchSchema,
  }),
  z.object({
    action: z.literal("search_hyperliquid"),
    reason: z.string(),
    search: MarketSearchSchema,
  }),
  z.object({
    action: z.literal("search_polymarket"),
    reason: z.string(),
    search: MarketSearchSchema,
    limit: z.number().int().positive().max(25).optional(),
  }),
  z.object({
    action: z.literal("finish_trade_expression"),
    reason: z.string(),
    final: TradeExpressionPlanSchema,
  }),
]);

type TradeExpressionLoopAction = z.infer<typeof TradeExpressionLoopActionSchema>;

export async function planTradeExpression(input: {
  ai: StructuredAiClient;
  marketData: MarketDataProvider;
  polymarketMarketFinder?: PolymarketMarketFinder;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<TradeExpressionPlan> {
  const searchThesis = thesisFromSource(input.sourcePost, input.userCommand);
  const observations: unknown[] = [];
  const maxSteps = 8;

  for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber += 1) {
    const action = await input.ai.generateObject({
      schema: TradeExpressionLoopActionSchema,
      name: "cassie_trade_expression_step",
      prompt: tradeExpressionLoopPrompt({
        sourcePost: input.sourcePost,
        userCommand: input.userCommand,
        observations,
        stepNumber,
        maxSteps,
      }),
    });

    if (action.action === "finish_trade_expression") {
      return TradeExpressionPlanSchema.parse(action.final);
    }

    observations.push(await executeTradeExpressionAction({ ...input, thesis: searchThesis }, action));
  }

  throw new Error("Trade expression planner exhausted its tool loop without finish_trade_expression.");
}

function thesisFromSource(sourcePost: SourcePost, userCommand: string): Thesis {
  const sourceText = sourcePost.quotedPostText
    ? `${sourcePost.text}\n\nQuoted post: ${sourcePost.quotedPostText}`
    : sourcePost.text;
  return {
    claim: `User requested a trade from this source context: ${sourceText}`,
    literalClaim: sourceText,
    impliedResearchQuestion: null,
    impliedTradeThesis: userCommand,
    sourceOrMetaSignal: null,
    hasExplicitTrade: true,
    hasConcreteResearchQuestion: false,
    hasTradableImplication: true,
    thesisStrength: "explicit",
    shouldNotInferTradeBecause: [],
    direction: "unclear",
    mentionedAssets: [],
    topics: [],
    timeHorizon: "unclear",
    evidenceQuality: "unknown",
    manipulationRisk: "unknown",
    confidence: 0.5,
  };
}

async function executeTradeExpressionAction(
  input: {
    marketData: MarketDataProvider;
    polymarketMarketFinder?: PolymarketMarketFinder;
    thesis: Thesis;
  },
  action: Exclude<TradeExpressionLoopAction, { action: "finish_trade_expression" }>,
) {
  if (action.action === "resolve_asset_mapping") {
    const values = [
      ...input.thesis.mentionedAssets,
      ...action.search.assets,
      ...action.search.queries,
    ].filter(Boolean);
    return {
      action: action.action,
      reason: action.reason,
      mappings: Array.from(new Set(values)).map((value) => ({
        asset: value,
        confidence: input.thesis.mentionedAssets.includes(value) ? "high" : "medium",
      })),
    };
  }

  const draft = draftTradeExpressionForSearch(input.thesis, action.search);

  if (action.action === "search_hyperliquid") {
    const candidates = await input.marketData.findCandidates({
      thesis: input.thesis,
      tradeExpression: draft,
    });
    return {
      action: action.action,
      reason: action.reason,
      search: action.search,
      candidates: MarketCandidateSchema.array().parse(candidates).map(compactMarketCandidate),
    };
  }

  if (!input.polymarketMarketFinder) {
    throw new Error("search_polymarket requires a configured Polymarket market finder dependency.");
  }

  const candidates = await input.polymarketMarketFinder.findPolymarketMarkets({
    thesis: input.thesis,
    tradeExpression: draft,
    limit: action.limit,
  });
  return {
    action: action.action,
    reason: action.reason,
    search: action.search,
    candidates: MarketCandidateSchema.array().parse(candidates).map(compactMarketCandidate),
  };
}

function draftTradeExpressionForSearch(thesis: Thesis, search: z.infer<typeof MarketSearchSchema>): TradeExpressionPlan {
  const firstAsset = search.assets[0] ?? thesis.mentionedAssets[0] ?? null;
  const candidates = [...search.assets, ...search.queries].map((query) => ({
    instrument: query,
    venueQuery: query,
    symbol: query,
    expression: thesis.direction === "bearish" ? "short" as const : "long" as const,
    thesis: thesis.claim,
    causalDirectness: 0.5,
    liquidity: 0.5,
    surprise: 0.5,
    timing: 0.5,
    crowdingRisk: 0.5,
    downsideAsymmetry: 0.5,
    evidenceQuality: thesis.confidence,
    expectedEdge: 0,
    tradableNow: false,
    rejectionReason: null,
    invalidation: [],
    evidenceNeeded: ["Confirm venue availability, price, and liquidity."],
  }));

  return {
    signal: thesis.claim,
    coreInterpretation: "Draft market-search expression.",
    directAsset: firstAsset,
    directAssetTradable: false,
    highestPurityExpression: search.queries[0] ?? firstAsset ?? "No concrete instrument",
    publicMarketReadThrough: "none",
    candidates,
    decision: "needs_market_check",
    reason: "Draft expression used only to search configured venues.",
    marketRouterInstructions: search.queries.join("; ") || null,
  };
}

function compactMarketCandidate(candidate: MarketCandidate) {
  return {
    venue: candidate.venue,
    instrument: candidate.instrument,
    side: candidate.side,
    symbol: candidate.symbol,
    conditionId: candidate.conditionId,
    outcomeTokenId: candidate.outcomeTokenId,
    marketQuestion: candidate.marketQuestion,
    marketSlug: candidate.marketSlug,
    outcome: candidate.outcome,
    markPrice: candidate.markPrice,
    heldSidePrice: candidate.heldSidePrice,
    yesPrice: candidate.yesPrice,
    noPrice: candidate.noPrice,
    liquidityScore: candidate.liquidityScore,
    spreadBps: candidate.spreadBps,
    estimatedSlippageBps: candidate.estimatedSlippageBps,
    thesisFit: candidate.thesisFit,
    reason: candidate.reason,
    warnings: candidate.warnings,
  };
}
