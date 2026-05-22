import type { StructuredAiClient } from "../ai/client.ts";
import type { MarketDataProvider, PolymarketMarketFinder } from "../ai/tools/market.ts";
import type { ResearchSearchLanes } from "../research/index.ts";

export interface CassieDependencies {
  ai?: StructuredAiClient;
  cheapAi?: StructuredAiClient;
  importantAi?: StructuredAiClient;
  marketData: MarketDataProvider;
  polymarketMarketFinder?: PolymarketMarketFinder;
  researchLanes: ResearchSearchLanes;
}
