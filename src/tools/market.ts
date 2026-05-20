import type { StructuredAiClient } from "../ai.js";
import {
  MarketSelectionSchema,
  type MarketCandidate,
  type MarketSelection,
  type ResearchReport,
  type Thesis,
} from "../schemas.js";
import { marketSelectionPrompt } from "../prompts.js";

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
      candidates,
    }),
  });
}
