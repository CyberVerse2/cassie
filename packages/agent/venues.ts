import {
  MarketCandidateSchema,
  PolymarketMarketAssessmentSchema,
  PolymarketQuoteSchema,
  type MarketCandidate,
  type PolymarketMarketAssessment,
  type PolymarketQuote,
  type TradeExpressionPlan,
} from "../core/schemas/index.ts";
import {
  assessPolymarketMarket,
  findPolymarketMarkets,
  quotePolymarketMarket,
  type MarketDataProvider,
  type PolymarketMarketFinder,
} from "../adapters/selection.ts";
import { thesisFromTradeExpression } from "./thesis.ts";

export async function searchVenues(input: {
  marketData: MarketDataProvider;
  polymarket?: PolymarketMarketFinder;
  thesis: ReturnType<typeof thesisFromTradeExpression>;
  tradeExpression: TradeExpressionPlan;
  venues?: Array<"hyperliquid" | "polymarket">;
  limit?: number;
}): Promise<MarketCandidate[]> {
  const venues = input.venues ?? [
    "hyperliquid",
    ...(input.polymarket ? ["polymarket" as const] : []),
  ];
  const candidateBatches: MarketCandidate[][] = [];

  if (venues.includes("hyperliquid")) {
    candidateBatches.push(await input.marketData.findCandidates({
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
    }));
  }

  if (venues.includes("polymarket")) {
    if (!input.polymarket) {
      throw new Error("search_venues requires a configured Polymarket market finder dependency.");
    }
    candidateBatches.push(await findPolymarketMarkets({
      polymarket: input.polymarket,
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
      limit: input.limit,
    }));
  }

  return uniqueMarketCandidates(candidateBatches.flat());
}

export async function assessExpressionFit(input: {
  polymarket?: PolymarketMarketFinder;
  tradeExpression: TradeExpressionPlan;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): Promise<MarketCandidate | PolymarketMarketAssessment> {
  if (input.candidate.venue !== "polymarket") {
    return MarketCandidateSchema.parse(input.candidate);
  }
  if (!input.polymarket) {
    throw new Error("assess_expression_fit requires a configured Polymarket market finder dependency.");
  }
  const thesis = thesisFromTradeExpression(input.tradeExpression);
  return PolymarketMarketAssessmentSchema.parse(await assessPolymarketMarket({
    polymarket: input.polymarket,
    thesis,
    tradeExpression: input.tradeExpression,
    market: {
      conditionId: input.candidate.conditionId,
      marketSlug: input.candidate.marketSlug,
      question: input.candidate.marketQuestion,
    },
    side: input.side ?? polymarketSideFromCandidate(input.candidate),
  }));
}

export async function quoteExpression(input: {
  polymarket?: PolymarketMarketFinder;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): Promise<MarketCandidate | PolymarketQuote> {
  if (input.candidate.venue !== "polymarket") {
    return MarketCandidateSchema.parse(input.candidate);
  }
  if (!input.polymarket) {
    throw new Error("quote_expression requires a configured Polymarket market finder dependency.");
  }
  if (!input.candidate.outcomeTokenId) {
    throw new Error("quote_expression requires a Polymarket outcome token id.");
  }
  return PolymarketQuoteSchema.parse(await quotePolymarketMarket({
    polymarket: input.polymarket,
    conditionId: input.candidate.conditionId,
    outcomeTokenId: input.candidate.outcomeTokenId,
    side: input.side ?? polymarketSideFromCandidate(input.candidate),
    yesPrice: input.candidate.yesPrice,
    noPrice: input.candidate.noPrice,
  }));
}

function polymarketSideFromCandidate(candidate: MarketCandidate): "yes" | "no" {
  if (candidate.outcome === "no" || candidate.side === "buy_no") return "no";
  return "yes";
}

function uniqueMarketCandidates(candidates: MarketCandidate[]): MarketCandidate[] {
  const seen = new Set<string>();
  return MarketCandidateSchema.array().parse(candidates).filter((candidate) => {
    const key = [
      candidate.venue,
      candidate.symbol,
      candidate.side,
      candidate.conditionId ?? "",
      candidate.outcomeTokenId ?? "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
