import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { CassieProduct } from "../packages/app/product.ts";
import {
  processXWebhookPayload,
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

  it("queues only Cassie mentions and dedupes retried webhook deliveries", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn(async () => ({ runId: `run_${createMentionRun.mock.calls.length}`, status: "queued" as const }));
    const product = { createMentionRun } as unknown as CassieProduct;
    const replyToPost = vi.fn(async () => ({ id: "reply_1", text: "hi" }));
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
      replyGateway: { replyToPost },
      userId: "user_1",
      cassieHandle: "cassiedottrade",
    });
    const retry = await processXWebhookPayload({
      product,
      store,
      payload,
      replyGateway: { replyToPost },
      userId: "user_1",
      cassieHandle: "cassiedottrade",
    });

    expect(first).toMatchObject({ received: 2, queued: 1, replied: 1, skipped: 1, failed: 0 });
    expect(retry).toMatchObject({ received: 2, queued: 0, replied: 0, skipped: 2, failed: 0 });
    expect(createMentionRun).toHaveBeenCalledTimes(1);
    expect(replyToPost).toHaveBeenCalledTimes(1);
    expect(replyToPost).toHaveBeenCalledWith({
      postId: "tweet_1",
      text: "hi",
    });
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

  it("records per-tweet failures after sending the visibility reply", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn(async () => {
      throw new Error("No Cassie settings found for user user_1.");
    });
    const replyToPost = vi.fn(async () => ({ id: "reply_1", text: "hi" }));
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
      replyGateway: { replyToPost },
      userId: "user_1",
      cassieHandle: "cassiedottrade",
      payload,
    });
    const retry = await processXWebhookPayload({
      product,
      store,
      replyGateway: { replyToPost },
      userId: "user_1",
      cassieHandle: "cassiedottrade",
      payload,
    });

    expect(first).toMatchObject({
      received: 1,
      queued: 0,
      replied: 1,
      skipped: 0,
      failed: 1,
      errors: [{ postId: "tweet_1", error: "No Cassie settings found for user user_1." }],
    });
    expect(retry).toMatchObject({
      received: 1,
      queued: 0,
      replied: 0,
      skipped: 0,
      failed: 1,
    });
    expect(replyToPost).toHaveBeenCalledTimes(1);
    expect(createMentionRun).toHaveBeenCalledTimes(2);
  });
});
