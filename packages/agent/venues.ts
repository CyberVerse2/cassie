import type { StructuredAiClient } from "../ai/client.ts";
import {
  ExpressionFitAssessmentSchema,
  MarketCandidateSchema,
  PolymarketQuoteSchema,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type OpportunityFrame,
  type PolymarketQuote,
  type Thesis,
  type TradeExpressionPlan,
} from "../core/schemas/index.ts";
import {
  findPolymarketMarkets,
  quotePolymarketMarket,
  type MarketDataProvider,
  type PolymarketMarketFinder,
} from "../adapters/selection.ts";
import { expressionFitPromptSpec, structuredPromptInput } from "../prompts/index.ts";

export type TradeExpressionIntent = {
  thesis: Thesis;
  tradeExpression: TradeExpressionPlan;
};

export type VenueSearchIntent = TradeExpressionIntent & {
  venues: Array<"hyperliquid" | "polymarket">;
  limit?: number;
};

export type VenueMarketCandidate = MarketCandidate;

export async function searchVenues(input: {
  marketData: MarketDataProvider;
  polymarket?: PolymarketMarketFinder;
  thesis: Thesis;
  tradeExpression: TradeExpressionPlan;
  venues?: Array<"hyperliquid" | "polymarket">;
  limit?: number;
}): Promise<VenueMarketCandidate[]> {
  const searchIntent = buildVenueSearchIntent(input);
  const venues = searchIntent.venues;
  const candidateBatches: VenueMarketCandidate[][] = [];
  const failures: string[] = [];
  let attemptedVenues = 0;

  if (venues.includes("hyperliquid") && shouldSearchDirectVenue(input.tradeExpression)) {
    attemptedVenues += 1;
    try {
      candidateBatches.push(await input.marketData.findCandidates({
        thesis: searchIntent.thesis,
        tradeExpression: searchIntent.tradeExpression,
      }));
    } catch (error) {
      failures.push(`hyperliquid: ${errorMessage(error)}`);
    }
  }

  if (venues.includes("polymarket")) {
    attemptedVenues += 1;
    try {
      if (!input.polymarket) {
        throw new Error("search_venues requires a configured Polymarket market finder dependency.");
      }
      candidateBatches.push(await findPolymarketMarkets({
        polymarket: input.polymarket,
        thesis: searchIntent.thesis,
        tradeExpression: searchIntent.tradeExpression,
        limit: searchIntent.limit,
      }));
    } catch (error) {
      failures.push(`polymarket: ${errorMessage(error)}`);
    }
  }

  if (attemptedVenues === 0) {
    return [];
  }

  if (failures.length > 0 && failures.length === attemptedVenues) {
    throw new Error(`Venue search failed across all requested venues: ${failures.join("; ")}`);
  }

  return uniqueMarketCandidates(candidateBatches.flat());
}

function shouldSearchDirectVenue(tradeExpression: TradeExpressionPlan): boolean {
  return tradeExpression.directAssetTradable
    || tradeExpression.candidateExpressions.some((candidate) =>
      (candidate.expressionRail === "crypto" || candidate.expressionRail === "pre_ipo")
        && candidate.intendedSide !== "avoid"
        && candidate.searchTerms.length > 0,
    );
}

function buildVenueSearchIntent(input: {
  thesis: Thesis;
  tradeExpression: TradeExpressionPlan;
  venues?: Array<"hyperliquid" | "polymarket">;
  limit?: number;
  polymarket?: PolymarketMarketFinder;
}): VenueSearchIntent {
  return {
    thesis: input.thesis,
    tradeExpression: input.tradeExpression,
    limit: input.limit,
    venues: input.venues ?? [
    "hyperliquid",
    ...(input.polymarket ? ["polymarket" as const] : []),
    ],
  };
}

export async function assessExpressionFit(input: {
  ai: StructuredAiClient;
  polymarket?: PolymarketMarketFinder;
  opportunityFrame: OpportunityFrame;
  tradeExpression: TradeExpressionPlan;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): Promise<ExpressionFitAssessment> {
  const candidate = MarketCandidateSchema.parse(input.candidate);
  return ExpressionFitAssessmentSchema.parse(await input.ai.generateObject({
    ...structuredPromptInput(expressionFitPromptSpec({
      opportunityFrame: input.opportunityFrame,
      tradeExpression: input.tradeExpression,
      candidate,
      side: input.side,
    })),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
