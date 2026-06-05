import "dotenv/config";
import { config } from "../packages/core/config.ts";
import { DrizzleCassieStore } from "../packages/core/db/drizzle-store.ts";
import { XWebhookClient } from "../packages/notifications/x.ts";

const webhookUrl = process.argv[2] ?? config.x.webhookUrl;
if (!webhookUrl) {
  throw new Error("X webhook sync requires X_WEBHOOK_URL or a webhook URL argument.");
}

const client = new XWebhookClient(
  config.x.bearerToken,
  config.x.userAccessToken,
  fetch,
  new DrizzleCassieStore(),
);
const result = await client.syncAccountActivityWebhook({
  webhookUrl,
  webhookId: config.x.accountActivityWebhookId,
});

console.log(JSON.stringify({
  webhookId: result.webhook.id,
  webhookUrl: result.webhook.url,
  webhookValid: result.webhook.valid,
  validationAttempted: result.validationAttempted,
  subscriptionCreated: result.subscriptionCreated,
}, null, 2));
