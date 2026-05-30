import "dotenv/config";
import { config } from "../packages/core/config.ts";
import { DrizzleCassieStore } from "../packages/core/db/drizzle-store.ts";
import {
  TelegramBotApi,
  pollTelegramUpdates,
} from "../packages/notifications/telegram.ts";

if (!config.telegram.botToken) {
  throw new Error("Telegram poller requires TELEGRAM_BOT_TOKEN.");
}

const store = new DrizzleCassieStore();
const gateway = new TelegramBotApi(config.telegram.botToken);
let webhookDeleted = false;
console.log("Cassie Telegram poller started.");

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

while (true) {
  try {
    if (!webhookDeleted) {
      await gateway.deleteWebhook({ dropPendingUpdates: false });
      webhookDeleted = true;
    }
    const result = await pollTelegramUpdates({
      store,
      gateway,
      env: config.telegram,
    });
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      received: result.received,
      connected: result.connected,
      ignored: result.ignored,
      errors: result.errors,
      nextOffset: result.nextOffset,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  await sleep(config.telegram.pollIntervalMs);
}
