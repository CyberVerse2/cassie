import { NextResponse } from "next/server";
import { config } from "../../../../../../packages/core/config";
import { DrizzleCassieStore } from "../../../../../../packages/core/db/drizzle-store";
import {
  processTelegramWebhookUpdate,
  TelegramBotApi,
  verifyTelegramWebhookSecret,
} from "../../../../../../packages/notifications/telegram";
import { apiError } from "../../_lib/account";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    verifyTelegramWebhookSecret({
      receivedSecret: request.headers.get("x-telegram-bot-api-secret-token"),
      expectedSecret: config.telegram.webhookSecretToken,
    });

    if (!config.telegram.botToken) {
      throw new Error("Telegram webhook requires TELEGRAM_BOT_TOKEN.");
    }

    const update = await request.json();
    const result = await processTelegramWebhookUpdate({
      store: new DrizzleCassieStore(),
      update,
      gateway: new TelegramBotApi(config.telegram.botToken),
    });

    console.log(JSON.stringify({
      event: "telegram.webhook.processed",
      updateId: result.updateId,
      connected: result.connected,
      ignored: result.ignored,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: "telegram.webhook.failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return apiError(error);
  }
}
