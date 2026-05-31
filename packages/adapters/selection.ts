import type { StructuredAiClient } from "../ai/client.ts";
import {
  MarketCandidateSchema,
  PolymarketMarketAssessmentSchema,
  PolymarketQuoteSchema,
  type MarketCandidate,
  type MarketSelection,
  type ExpressionFitAssessment,
  type PolymarketMarketAssessment,
  type PolymarketQuote,
  type Thesis,
  type TradeExpressionPlan,
} from "../core/schemas/index.ts";
import {
  marketSelectionPromptSpec,
  polymarketDiscoveryQueryPromptSpec,
  polymarketSearchResultSelectionPromptSpec,
  structuredPromptInput,
} from "../prompts/index.ts";

export interface MarketDataProvider {
  findCandidates(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate[]>;
}

export interface PolymarketMarketFinder {
  findPolymarketMarkets(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    limit?: number;
  }): Promise<MarketCandidate[]>;
  assessPolymarketMarket(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    market: {
      conditionId?: string | null;
      marketSlug?: string | null;
      question?: string | null;
    };
    side: "yes" | "no";
  }): Promise<PolymarketMarketAssessment>;
  quotePolymarketMarket(input: {
    conditionId?: string | null;
    outcomeTokenId: string;
    side: "yes" | "no";
    yesPrice?: number | null;
    noPrice?: number | null;
  }): Promise<PolymarketQuote>;
}

export interface PolymarketDiscoveryQueryPlanner {
  planPolymarketSearchQueries(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    limit?: number;
  }): Promise<string[]>;
}

export type PolymarketSearchResultForSelection = {
  slug: string;
  question: string;
  active?: boolean;
  closed?: boolean;
  endDate?: string;
  resolutionRules?: string | null;
  outcomes?: unknown;
  outcomePrices?: unknown;
  liquidityUsd?: number | null;
  volumeUsd?: number | null;
};

export interface PolymarketSearchResultSelector {
  selectPolymarketSearchResults(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    markets: PolymarketSearchResultForSelection[];
    limit?: number;
  }): Promise<string[]>;
}

export class AiPolymarketDiscoveryQueryPlanner implements PolymarketDiscoveryQueryPlanner {
  constructor(private readonly ai: StructuredAiClient) {}

  async planPolymarketSearchQueries(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    limit?: number;
  }): Promise<string[]> {
    const limit = input.limit ?? 8;
    const result = await this.ai.generateObject({
      ...structuredPromptInput(polymarketDiscoveryQueryPromptSpec({
        thesis: input.thesis,
        tradeExpression: input.tradeExpression,
        limit,
      })),
    });

    return Array.from(new Set(result.queries.map((query) => query.trim()).filter(Boolean))).slice(0, limit);
  }
}

export class AiPolymarketSearchResultSelector implements PolymarketSearchResultSelector {
  constructor(private readonly ai: StructuredAiClient) {}

  async selectPolymarketSearchResults(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    markets: PolymarketSearchResultForSelection[];
    limit?: number;
  }): Promise<string[]> {
    const limit = input.limit ?? 10;
    const result = await this.ai.generateObject({
      ...structuredPromptInput(polymarketSearchResultSelectionPromptSpec({
        thesis: input.thesis,
        tradeExpression: input.tradeExpression,
        markets: input.markets,
        limit,
      })),
    });
    const validSlugs = new Set(input.markets.map((market) => market.slug));
    return Array.from(new Set(result.selectedMarketSlugs
      .map((slug) => slug.trim())
      .filter((slug) => validSlugs.has(slug))))
      .slice(0, limit);
  }
}

export async function selectMarket(input: {
  ai: StructuredAiClient;
  marketData: MarketDataProvider;
  thesis: Thesis;
  tradeExpression?: TradeExpressionPlan;
  candidates?: MarketCandidate[];
  fitAssessments?: ExpressionFitAssessment[];
  quotes?: unknown[];
}): Promise<MarketSelection> {
  const providerCandidates = input.candidates === undefined
    ? await input.marketData.findCandidates({
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
    })
    : [];
  const candidates = uniqueMarketCandidates([
    ...(input.candidates ?? []),
    ...providerCandidates,
  ]);

  if (candidates.length === 0) {
    return {
      decision: "no_selection",
      selectedMarket: null,
      selectedCandidateId: null,
      rejectionReason: "No configured market-data candidate matched the trade expression.",
      rankedCandidates: [],
      rejectedCandidates: [],
      noTradeReason: "No configured market-data candidate matched the trade expression.",
    };
  }

  return input.ai.generateObject({
    ...structuredPromptInput(marketSelectionPromptSpec({
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
      candidates,
      fitAssessments: input.fitAssessments ?? [],
      quotes: input.quotes ?? [],
    })),
  });
}

function uniqueMarketCandidates(candidates: MarketCandidate[]): MarketCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
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

export async function findPolymarketMarkets(input: {
  polymarket: PolymarketMarketFinder;
  thesis: Thesis;
  tradeExpression?: TradeExpressionPlan;
  limit?: number;
}): Promise<MarketCandidate[]> {
  const candidates = await input.polymarket.findPolymarketMarkets({
    thesis: input.thesis,
    tradeExpression: input.tradeExpression,
    limit: input.limit,
  });

  return MarketCandidateSchema.array().parse(candidates);
}

export async function assessPolymarketMarket(input: {
  polymarket: PolymarketMarketFinder;
  thesis: Thesis;
  tradeExpression?: TradeExpressionPlan;
  market: {
    conditionId?: string | null;
    marketSlug?: string | null;
    question?: string | null;
  };
  side: "yes" | "no";
}): Promise<PolymarketMarketAssessment> {
  const assessment = await input.polymarket.assessPolymarketMarket({
    thesis: input.thesis,
    tradeExpression: input.tradeExpression,
    market: input.market,
    side: input.side,
  });

  return PolymarketMarketAssessmentSchema.parse(assessment);
}

export async function quotePolymarketMarket(input: {
  polymarket: PolymarketMarketFinder;
  conditionId?: string | null;
  outcomeTokenId: string;
  side: "yes" | "no";
  yesPrice?: number | null;
  noPrice?: number | null;
}): Promise<PolymarketQuote> {
  const quote = await input.polymarket.quotePolymarketMarket({
    conditionId: input.conditionId,
    outcomeTokenId: input.outcomeTokenId,
    side: input.side,
    yesPrice: input.yesPrice,
    noPrice: input.noPrice,
  });

  return PolymarketQuoteSchema.parse(quote);
}
