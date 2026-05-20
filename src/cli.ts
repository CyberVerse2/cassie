import "dotenv/config";
import { CassieProduct } from "./product.js";

const command = process.argv.slice(2).join(" ") || "@Cassie what do you think?";

const product = new CassieProduct();
await product.upsertSettings({
  userId: "local-user",
  allowedVenues: ["hyperliquid", "polymarket"],
  allowedAssets: ["SOL"],
  defaultTradeSizeUsd: 50,
  maxTradeSizeUsd: 100,
  maxDailyLossUsd: 100,
  minConfidence: 0.75,
  maxSpreadBps: 50,
  autoTradeEnabled: false,
});

const result = await product.processMention({
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
  userId: "local-user",
});

console.log(JSON.stringify(result, null, 2));
