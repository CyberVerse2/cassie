import { NextResponse } from "next/server";
import { CassieProduct } from "../../../../../../packages/app/product";
import {
  processXWebhookPayload,
  recordXWebhookDeliveryAttempt,
  verifyXWebhookSignature,
  xWebhookResponseToken,
} from "../../../../../../packages/app/x-webhook";
import { config } from "../../../../../../packages/core/config";
import { DrizzleCassieStore } from "../../../../../../packages/core/db/drizzle-store";
import { XApiReplyClient } from "../../../../../../packages/notifications/x";
import { apiError } from "../../_lib/account";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const crcToken = new URL(request.url).searchParams.get("crc_token");
    if (!crcToken) {
      throw new Error("X webhook CRC request is missing crc_token.");
    }

    return NextResponse.json({
      response_token: xWebhookResponseToken({
        crcToken,
        consumerSecret: config.x.consumerSecret,
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const store = new DrizzleCassieStore();
    const deliveryAttempt = await recordXWebhookDeliveryAttempt({
      store,
      rawBody,
      headers: request.headers,
    });
    console.log(JSON.stringify({
      event: "x.webhook.received",
      attemptId: deliveryAttempt.attemptId,
      bytes: rawBody.byteLength,
      signaturePresent: Boolean(request.headers.get("x-twitter-webhooks-signature")),
      tweetIds: deliveryAttempt.tweetIds,
    }));
    verifyXWebhookSignature({
      rawBody,
      signature: request.headers.get("x-twitter-webhooks-signature"),
      consumerSecret: config.x.consumerSecret,
    });

    const product = new CassieProduct(store);
    const result = await processXWebhookPayload({
      product,
      store,
      payload: JSON.parse(rawBody.toString("utf8")),
      replyClient: new XApiReplyClient(undefined, fetch, store),
    });
    console.log(JSON.stringify({
      event: "x.webhook.processed",
      received: result.received,
      queued: result.queued,
      skipped: result.skipped,
      failed: result.failed,
      runIds: result.runIds,
      errors: result.errors,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: "x.webhook.failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return apiError(error);
  }
}
