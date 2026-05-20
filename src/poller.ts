import "dotenv/config";
import { CassieProduct } from "./product.js";

const userId = process.env.X_POLL_USER_ID;
if (!userId) {
  throw new Error("X poller requires X_POLL_USER_ID.");
}

const product = new CassieProduct();
const intervalMs = Number(process.env.X_POLL_INTERVAL_MS ?? 120_000);

async function tick() {
  const result = await product.pollXMentions(userId as string);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    processed: result.processed,
    newestId: result.newestId,
  }));
}

await tick();
setInterval(() => {
  tick().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
  });
}, intervalMs);
