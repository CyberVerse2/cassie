import type { StructuredAiClient } from "../client.ts";
import {
  MarketCandidateSchema,
  MarketSelectionSchema,
  type MarketCandidate,
  type MarketSelection,
  type ResearchReport,
  type Thesis,
  type TradeExpressionPlan,
} from "../../core/schemas/index.ts";
import { marketSelectionPrompt } from "../prompts/index.ts";

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
