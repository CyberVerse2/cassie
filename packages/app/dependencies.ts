import type { StructuredAiClient } from "../ai/client.ts";
import type { MarketDataProvider, PolymarketMarketFinder } from "../agent/tools/market.ts";

export interface CassieDependencies {
  ai?: StructuredAiClient;
  cheapAi?: StructuredAiClient;
  importantAi?: StructuredAiClient;
  marketData: MarketDataProvider;
  polymarketMarketFinder?: PolymarketMarketFinder;
}
