import "dotenv/config";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// Registers (or re-points) the Circle webhook subscription that pushes inbound
// USDC notifications to the app. Usage:
//   npx tsx scripts/setup-circle-webhook.ts https://cassie.trade/api/webhooks/circle
async function main() {
  const endpoint = process.argv[2];
  if (!endpoint) {
    throw new Error("Pass the webhook endpoint URL as the first argument.");
  }
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY!,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
  });

  const existing = await client.listSubscriptions();
  const match = existing.data?.subscriptions?.find((sub) =>
    sub.endpoint === endpoint
  );
  if (match) {
    console.log("Subscription already exists:", match.id, match.endpoint);
    return;
  }

  const created = await client.createSubscription({ endpoint });
  console.log("Created subscription:", JSON.stringify(created.data, null, 2));
}

main().catch((error) => {
  console.error(
    "FAILED:",
    error?.response?.data ? JSON.stringify(error.response.data) : error?.message,
  );
  process.exit(1);
});
