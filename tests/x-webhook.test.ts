import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { CassieProduct } from "../packages/app/product.ts";
import {
  processXWebhookPayload,
  recordXWebhookDeliveryAttempt,
  verifyXWebhookSignature,
  xWebhookResponseToken,
} from "../packages/app/x-webhook.ts";

describe("X webhook", () => {
  it("creates the expected CRC response token", () => {
    const responseToken = xWebhookResponseToken({
      crcToken: "challenge",
      consumerSecret: "secret",
    });

    expect(responseToken).toBe(`sha256=${createHmac("sha256", "secret")
      .update("challenge")
      .digest("base64")}`);
  });

  it("verifies POST signatures against the raw request body", () => {
    const rawBody = JSON.stringify({ tweet_create_events: [] });
    const signature = xWebhookResponseToken({
      crcToken: rawBody,
      consumerSecret: "secret",
    });

    expect(() => verifyXWebhookSignature({
      rawBody,
      signature,
      consumerSecret: "secret",
    })).not.toThrow();
    expect(() => verifyXWebhookSignature({
      rawBody,
      signature,
      consumerSecret: "wrong",
    })).toThrow("X webhook signature did not match.");
  });

  it("records raw webhook delivery attempts before processing", async () => {
    const store = new InMemoryCassieStore();
    const rawBody = Buffer.from(JSON.stringify({
      for_user_id: "2060718466630406149",
      tweet_create_events: [
        { id_str: "tweet_1", full_text: "@cassiedottrade trade" },
        { id: 123, text: "hello" },
      ],
    }));

    const attempt = await recordXWebhookDeliveryAttempt({
      store,
      rawBody,
      headers: new Headers({
        "content-type": "application/json",
        "user-agent": "Twitterbot/1.0",
        "x-twitter-webhooks-signature": "sha256=test",
      }),
    });

    expect(attempt).toMatchObject({
      bytes: rawBody.byteLength,
      contentType: "application/json",
      forUserId: "2060718466630406149",
      parsed: true,
      signaturePresent: true,
      tweetIds: ["tweet_1", "123"],
      userAgent: "Twitterbot/1.0",
    });
    await expect(store.getRuntimeState(`x_webhook_delivery:${attempt.receivedAt}:${attempt.attemptId}`))
      .resolves.toEqual(attempt);
  });

  it("queues only Cassie mentions and dedupes retried webhook deliveries", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn(async () => ({ runId: `run_${createMentionRun.mock.calls.length}`, status: "queued" as const }));
    const product = { createMentionRun } as unknown as CassieProduct;
    const payload = {
      for_user_id: "205000",
      tweet_create_events: [
        {
          id_str: "tweet_1",
          full_text: "hey @cassiedottrade trade this",
          created_at: "Sat May 30 16:00:00 +0000 2026",
          user: {
            screen_name: "source_user",
            name: "Source User",
          },
          entities: {
            urls: [{ expanded_url: "https://example.com/signal" }],
          },
        },
        {
          id_str: "tweet_2",
          full_text: "not for cassie",
          user: {
            screen_name: "other_user",
            name: "Other User",
          },
        },
      ],
    };

    const first = await processXWebhookPayload({
      product,
      store,
      payload,
      userId: "user_1",
      cassieHandle: "cassiedottrade",
    });
    const retry = await processXWebhookPayload({
      product,
      store,
      payload,
      userId: "user_1",
      cassieHandle: "cassiedottrade",
    });

    expect(first).toMatchObject({ received: 2, queued: 1, skipped: 1, failed: 0 });
    expect(retry).toMatchObject({ received: 2, queued: 0, skipped: 2, failed: 0 });
    expect(createMentionRun).toHaveBeenCalledTimes(1);
    expect(createMentionRun).toHaveBeenCalledWith({
      userId: "user_1",
      userCommand: "hey @cassiedottrade trade this",
      sourcePost: {
        platform: "x",
        postId: "tweet_1",
        url: "https://x.com/source_user/status/tweet_1",
        authorHandle: "source_user",
        authorName: "Source User",
        text: "hey @cassiedottrade trade this",
        createdAt: "Sat May 30 16:00:00 +0000 2026",
        quotedPostText: null,
        linkedUrls: ["https://example.com/signal"],
        mediaDescriptions: [],
      },
    });
  });

  it("uses the parent tweet as the analysis source when Cassie is tagged in a reply", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn(async () => ({ runId: "run_1", status: "queued" as const }));
    const product = { createMentionRun } as unknown as CassieProduct;

    const result = await processXWebhookPayload({
      product,
      store,
      userId: "user_1",
      cassieHandle: "cassiedottrade",
      payload: {
        tweet_create_events: [{
          id_str: "222",
          full_text: "@cassiedottrade trade this",
          in_reply_to_status_id_str: "111",
          in_reply_to_screen_name: "source_user",
          user: {
            screen_name: "trader",
            name: "Trader",
          },
        }],
      },
    });

    expect(result).toMatchObject({ received: 1, queued: 1, skipped: 0, failed: 0 });
    expect(createMentionRun).toHaveBeenCalledWith({
      userId: "user_1",
      userCommand: "@cassiedottrade trade this",
      sourcePost: {
        platform: "x",
        postId: "111",
        url: "https://x.com/source_user/status/111",
        authorHandle: "source_user",
        authorName: null,
        text: "https://x.com/source_user/status/111",
        createdAt: null,
        quotedPostText: null,
        linkedUrls: [],
        mediaDescriptions: [],
      },
    });
    await expect(store.getRuntimeState("x_reply_target:run_1")).resolves.toEqual({
      postId: "222",
      url: "https://x.com/trader/status/222",
    });
  });

  it("queues webhook mentions under the connected user who tagged Cassie", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings({
      userId: "did:privy:trader",
      privyUserId: "did:privy:trader",
      privyWalletId: "wallet_1",
      walletAddress: "0xabc",
      profile: { name: "Trader", handle: "@trader", avatarUrl: null },
      x: { userId: "1574209048425242624", username: "trader" },
      defaultTradeSizeUsd: 5,
      telegram: null,
    });
    const createMentionRun = vi.fn(async () => ({ runId: "run_1", status: "queued" as const }));
    const product = { createMentionRun } as unknown as CassieProduct;

    const result = await processXWebhookPayload({
      product,
      store,
      cassieHandle: "cassiedottrade",
      payload: {
        for_user_id: "2060718466630406149",
        tweet_create_events: [{
          id_str: "222",
          author_id: "1574209048425242624",
          full_text: "@source @cassiedottrade trade this",
          in_reply_to_status_id_str: "111",
          in_reply_to_screen_name: "source",
          user: {
            id_str: "1574209048425242624",
            screen_name: "trader",
            name: "Trader",
          },
        }],
      },
    });

    expect(result).toMatchObject({ received: 1, queued: 1, skipped: 0, failed: 0 });
    expect(createMentionRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: "did:privy:trader",
      userCommand: "@source @cassiedottrade trade this",
    }));
    await expect(store.getRuntimeState("x_webhook:did:privy:trader:222")).resolves.toMatchObject({
      runId: "run_1",
    });
  });

  it("skips retweets and blocked-user mention payloads", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn();
    const product = { createMentionRun } as unknown as CassieProduct;

    const blocked = await processXWebhookPayload({
      product,
      store,
      userId: "user_1",
      cassieHandle: "cassiedottrade",
      payload: {
        user_has_blocked: "true",
        tweet_create_events: [{ id_str: "tweet_1", text: "@cassiedottrade trade" }],
      },
    });
    const retweet = await processXWebhookPayload({
      product,
      store,
      userId: "user_1",
      cassieHandle: "cassiedottrade",
      payload: {
        tweet_create_events: [{ id_str: "tweet_2", text: "@cassiedottrade trade", retweeted_status: {} }],
      },
    });

    expect(blocked).toMatchObject({ received: 1, queued: 0, skipped: 1 });
    expect(retweet).toMatchObject({ received: 1, queued: 0, skipped: 1 });
    expect(createMentionRun).not.toHaveBeenCalled();
  });

  it("records per-tweet failures without stopping the webhook batch", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn(async () => {
      throw new Error("No Cassie settings found for user user_1.");
    });
    const product = { createMentionRun } as unknown as CassieProduct;
    const payload = {
      tweet_create_events: [{
        id_str: "tweet_1",
        text: "@cassiedottrade trade",
        user: { screen_name: "source_user" },
      }],
    };

    const first = await processXWebhookPayload({
      product,
      store,
      userId: "user_1",
      cassieHandle: "cassiedottrade",
      payload,
    });
    const retry = await processXWebhookPayload({
      product,
      store,
      userId: "user_1",
      cassieHandle: "cassiedottrade",
      payload,
    });

    expect(first).toMatchObject({
      received: 1,
      queued: 0,
      skipped: 0,
      failed: 1,
      errors: [{ postId: "tweet_1", error: "No Cassie settings found for user user_1." }],
    });
    expect(retry).toMatchObject({
      received: 1,
      queued: 0,
      skipped: 0,
      failed: 1,
    });
    expect(createMentionRun).toHaveBeenCalledTimes(2);
  });
});
