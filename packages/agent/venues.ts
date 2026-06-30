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
import { formatErrorForLog } from "../core/helpers/error-format.ts";
import { isConfiguredDirectVenueExpressionRail } from "../core/expression-rails.ts";
import {
  expressionFitPromptSpec,
  structuredPromptInput,
} from "../prompts/index.ts";
import { enforceFitScoreInvariant } from "./fit-assessment.ts";

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
  hyperliquidMarketData: MarketDataProvider;
  polymarket?: PolymarketMarketFinder;
  thesis: Thesis;
  tradeExpression: TradeExpressionPlan;
  venues?: Array<"hyperliquid" | "polymarket">;
  limit?: number;
}): Promise<VenueMarketCandidate[]> {
  const searchIntent = buildVenueSearchIntent(input);
  const venues = searchIntent.venues;
  const tasks: Array<{
    venue: "hyperliquid" | "polymarket";
    run: () => Promise<VenueMarketCandidate[]>;
  }> = [];

  if (
    venues.includes("hyperliquid") &&
    shouldSearchDirectVenue(input.tradeExpression)
  ) {
    tasks.push({
      venue: "hyperliquid",
      run: () =>
        input.hyperliquidMarketData.findCandidates({
          thesis: searchIntent.thesis,
          tradeExpression: searchIntent.tradeExpression,
        }),
    });
  }

  if (venues.includes("polymarket")) {
    tasks.push({
      venue: "polymarket",
      run: () => {
        if (!input.polymarket) {
          throw new Error(
            "search_venues requires a configured Polymarket market finder dependency.",
          );
        }
        return findPolymarketMarkets({
          polymarket: input.polymarket,
          thesis: searchIntent.thesis,
          tradeExpression: searchIntent.tradeExpression,
          limit: searchIntent.limit,
        });
      },
    });
  }

  if (tasks.length === 0) {
    return [];
  }

  const results = await Promise.all(
    tasks.map(async (task) => {
      try {
        return {
          venue: task.venue,
          candidates: await task.run(),
          error: null,
        };
      } catch (error) {
        return {
          venue: task.venue,
          candidates: [],
          error: errorMessage(error),
        };
      }
    }),
  );

  const failures = results
    .filter((result) => result.error)
    .map((result) => `${result.venue}: ${result.error}`);

  const requiredFailures = results
    .filter(
      (result) =>
        result.error &&
        isRequiredVenueFailure(searchIntent.tradeExpression, result.venue),
    )
    .map((result) => `${result.venue}: ${result.error}`);

  if (requiredFailures.length > 0) {
    throw new Error(
      `Required venue search failed: ${requiredFailures.join("; ")}`,
    );
  }

  if (failures.length > 0 && failures.length === tasks.length) {
    throw new Error(
      `Venue search failed across all requested venues: ${failures.join("; ")}`,
    );
  }

  return sortCandidatesByExpressionPriority(
    uniqueMarketCandidates(results.flatMap((result) => result.candidates)),
    searchIntent.tradeExpression,
  );
}

function isRequiredVenueFailure(
  tradeExpression: TradeExpressionPlan,
  venue: "hyperliquid" | "polymarket",
): boolean {
  if (venue !== "polymarket") return false;

  return tradeExpression.candidateExpressions.some(
    (candidate) =>
      candidate.expressionRail === "prediction_market" &&
      candidate.priority === "high" &&
      candidate.intendedSide !== "avoid" &&
      candidate.directness === "direct" &&
      candidate.searchTerms.length > 0,
  );
}

function shouldSearchDirectVenue(
  tradeExpression: TradeExpressionPlan,
): boolean {
  return (
    tradeExpression.directAssetTradable ||
    tradeExpression.candidateExpressions.some(
      (candidate) =>
        isConfiguredDirectVenueExpressionRail(candidate.expressionRail) &&
        candidate.intendedSide !== "avoid" &&
        candidate.searchTerms.length > 0,
    )
  );
}

function sortCandidatesByExpressionPriority(
  candidates: VenueMarketCandidate[],
  tradeExpression: TradeExpressionPlan,
): VenueMarketCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      candidateExpressionScore(b, tradeExpression) -
      candidateExpressionScore(a, tradeExpression),
  );
}

function candidateExpressionScore(
  candidate: VenueMarketCandidate,
  tradeExpression: TradeExpressionPlan,
): number {
  return Math.max(
    0,
    ...tradeExpression.candidateExpressions
      .filter((expression) => candidateMatchesExpression(candidate, expression))
      .map(
        (expression) =>
          priorityScore(expression.priority) +
          directnessScore(expression.directness) +
          expression.confidence,
      ),
  );
}

function candidateMatchesExpression(
  candidate: VenueMarketCandidate,
  expression: TradeExpressionPlan["candidateExpressions"][number],
): boolean {
  if (expression.intendedSide === "avoid") return false;
  if (candidate.venue === "polymarket") {
    return (
      expression.expressionRail === "prediction_market" &&
      predictionMarketCandidateSide(candidate) === expression.intendedSide
    );
  }
  return (
    isConfiguredDirectVenueExpressionRail(expression.expressionRail) &&
    candidate.side === expression.intendedSide
  );
}

function predictionMarketCandidateSide(
  candidate: VenueMarketCandidate,
): "yes" | "no" | null {
  if (candidate.side === "buy_yes" || candidate.outcome === "yes") return "yes";
  if (candidate.side === "buy_no" || candidate.outcome === "no") return "no";
  return null;
}

function priorityScore(priority: string): number {
  if (priority === "high") return 300;
  if (priority === "medium") return 200;
  return 100;
}

function directnessScore(directness: string): number {
  if (directness === "direct") return 30;
  if (directness === "strong_proxy") return 20;
  if (directness === "weak_proxy") return 10;
  return 0;
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
  opportunityFrame: OpportunityFrame;
  tradeExpression: TradeExpressionPlan;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): Promise<ExpressionFitAssessment> {
  const candidate = MarketCandidateSchema.parse(input.candidate);
  return enforceFitScoreInvariant(
    ExpressionFitAssessmentSchema.parse(
      await input.ai.generateObject({
        ...structuredPromptInput(
          expressionFitPromptSpec({
            opportunityFrame: input.opportunityFrame,
            tradeExpression: input.tradeExpression,
            candidate,
            side: input.side,
          }),
        ),
      }),
    ),
  );
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
    throw new Error(
      "quote_expression requires a configured Polymarket market finder dependency.",
    );
  }
  if (!input.candidate.outcomeTokenId) {
    throw new Error("quote_expression requires a Polymarket outcome token id.");
  }
  return PolymarketQuoteSchema.parse(
    await quotePolymarketMarket({
      polymarket: input.polymarket,
      conditionId: input.candidate.conditionId,
      outcomeTokenId: input.candidate.outcomeTokenId,
      side: input.side ?? polymarketSideFromCandidate(input.candidate),
      yesPrice: input.candidate.yesPrice,
      noPrice: input.candidate.noPrice,
    }),
  );
}

function polymarketSideFromCandidate(candidate: MarketCandidate): "yes" | "no" {
  if (candidate.outcome === "no" || candidate.side === "buy_no") return "no";
  return "yes";
}

function uniqueMarketCandidates(
  candidates: MarketCandidate[],
): MarketCandidate[] {
  const seen = new Set<string>();
  return MarketCandidateSchema.array()
    .parse(candidates)
    .filter((candidate) => {
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

const errorMessage = formatErrorForLog;
