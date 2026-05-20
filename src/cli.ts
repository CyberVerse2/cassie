import "dotenv/config";
import { OpenAiStructuredClient } from "./ai.js";
import { runCassie } from "./supervisor.js";
import type { MarketDataProvider } from "./tools/market.js";
import type { ResearchSearchLanes } from "./tools/research.js";

const command = process.argv.slice(2).join(" ") || "@Cassie what do you think?";

const marketData: MarketDataProvider = {
  async findCandidates() {
    throw new Error("Market data provider is not configured.");
  },
};

const researchLanes: ResearchSearchLanes = {
  async runOpenAiWebSearch() {
    throw new Error("OpenAI/Web Search lane is not configured.");
  },
  async runGrokXSearch() {
    throw new Error("Grok X Search lane is not configured.");
  },
};

const result = await runCassie({
  deps: {
    ai: new OpenAiStructuredClient(),
    marketData,
    researchLanes,
  },
  userCommand: command,
  sourcePost: {
    platform: "x",
    postId: null,
    url: null,
    authorHandle: "example",
    authorName: "Example",
    text: "Solana ETF approval is basically inevitable now. Market is asleep.",
    createdAt: null,
  },
  userSettings: {
    userId: "local-user",
    allowedVenues: ["hyperliquid", "polymarket"],
    allowedAssets: ["SOL"],
    defaultTradeSizeUsd: 50,
    maxTradeSizeUsd: 100,
    maxDailyLossUsd: 100,
    minConfidence: 0.75,
    maxSpreadBps: 50,
    autoTradeEnabled: false,
  },
});

console.log(JSON.stringify(result, null, 2));
