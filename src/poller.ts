import "dotenv/config";
import { CassieProduct } from "../packages/workflows/product.ts";

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
    queued: result.queued,
    newestId: result.newestId,
  }));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

while (true) {
  try {
    await tick();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  await sleep(intervalMs);
}
