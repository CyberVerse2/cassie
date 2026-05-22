import type { StructuredAiClient } from "../client.ts";
import { z } from "zod";
import {
  MarketCandidateSchema,
  MarketSelectionSchema,
  PolymarketMarketAssessmentSchema,
  PolymarketQuoteSchema,
  type MarketCandidate,
  type MarketSelection,
  type PolymarketMarketAssessment,
  type PolymarketQuote,
  type ResearchReport,
  type Thesis,
  type TradeExpressionPlan,
} from "../../core/schemas/index.ts";
import { marketSelectionPrompt, polymarketDiscoveryQueryPrompt } from "../prompts/index.ts";

export interface MarketDataProvider {
  findCandidates(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate[]>;
}

export interface PolymarketMarketFinder {
  findPolymarketMarkets(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
    limit?: number;
  }): Promise<MarketCandidate[]>;
  assessPolymarketMarket(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
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
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
    limit?: number;
  }): Promise<string[]>;
}

const PolymarketDiscoveryQueryPlanSchema = z.object({
  queries: z.array(z.string().min(2)).max(8),
});

export class AiPolymarketDiscoveryQueryPlanner implements PolymarketDiscoveryQueryPlanner {
  constructor(private readonly ai: StructuredAiClient) {}

  async planPolymarketSearchQueries(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
    limit?: number;
  }): Promise<string[]> {
    const limit = input.limit ?? 8;
    const result = await this.ai.generateObject({
      schema: PolymarketDiscoveryQueryPlanSchema,
      name: "cassie_polymarket_discovery_queries",
      tier: "expensive",
      prompt: polymarketDiscoveryQueryPrompt({
        thesis: input.thesis,
        researchReport: input.researchReport,
        tradeExpression: input.tradeExpression,
        limit,
      }),
    });

    return Array.from(new Set(result.queries.map((query) => query.trim()).filter(Boolean))).slice(0, limit);
  }
}

export async function selectMarket(input: {
  ai: StructuredAiClient;
  marketData: MarketDataProvider;
  thesis: Thesis;
  researchReport?: ResearchReport;
  tradeExpression?: TradeExpressionPlan;
  candidates?: MarketCandidate[];
}): Promise<MarketSelection> {
  const providerCandidates = await input.marketData.findCandidates({
    thesis: input.thesis,
    researchReport: input.researchReport,
    tradeExpression: input.tradeExpression,
  });
  const candidates = uniqueMarketCandidates([
    ...(input.candidates ?? []),
    ...providerCandidates,
  ]);

  if (candidates.length === 0) {
    return {
      selectedMarket: null,
      rejectedCandidates: [],
      noTradeReason: "No configured market-data candidate matched the trade expression.",
    };
  }

  return input.ai.generateObject({
    schema: MarketSelectionSchema,
    name: "cassie_market_selection",
    prompt: marketSelectionPrompt({
      thesis: input.thesis,
      researchReport: input.researchReport,
      tradeExpression: input.tradeExpression,
      candidates,
    }),
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
  researchReport?: ResearchReport;
  tradeExpression?: TradeExpressionPlan;
  limit?: number;
}): Promise<MarketCandidate[]> {
  const candidates = await input.polymarket.findPolymarketMarkets({
    thesis: input.thesis,
    researchReport: input.researchReport,
    tradeExpression: input.tradeExpression,
    limit: input.limit,
  });

  return MarketCandidateSchema.array().parse(candidates);
}

export async function assessPolymarketMarket(input: {
  polymarket: PolymarketMarketFinder;
  thesis: Thesis;
  researchReport?: ResearchReport;
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
    researchReport: input.researchReport,
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
