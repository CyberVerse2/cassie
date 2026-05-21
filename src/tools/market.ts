import type { StructuredAiClient } from "../ai.ts";
import {
  MarketSelectionSchema,
  type MarketCandidate,
  type MarketSelection,
  type ResearchReport,
  type Thesis,
  type TradeExpressionPlan,
} from "../schemas.ts";
import { marketSelectionPrompt } from "../prompts.ts";

export interface MarketDataProvider {
  findCandidates(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
  }): Promise<MarketCandidate[]>;
}

export async function selectMarket(input: {
  ai: StructuredAiClient;
  marketData: MarketDataProvider;
  thesis: Thesis;
  researchReport?: ResearchReport;
  tradeExpression?: TradeExpressionPlan;
}): Promise<MarketSelection> {
  const candidates = await input.marketData.findCandidates({
    thesis: input.thesis,
    researchReport: input.researchReport,
  });

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
