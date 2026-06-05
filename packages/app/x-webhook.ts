import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SourcePost } from "../core/schemas/index.ts";
import type { CassieStore } from "../core/db/store.ts";
import { config as runtimeConfig } from "../core/config.ts";
import type { CassieProduct } from "./product.ts";

const XUrlEntitySchema = z.object({
  expanded_url: z.string().optional(),
  unwound: z.object({
    url: z.string().optional(),
  }).optional(),
  url: z.string().optional(),
}).passthrough();

const XTweetEntitiesSchema = z.object({
  urls: z.array(XUrlEntitySchema).optional(),
}).passthrough();

const XWebhookUserSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  id_str: z.string().optional(),
  name: z.string().nullable().optional(),
  screen_name: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
}).passthrough();

const XWebhookTweetSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  id_str: z.string().optional(),
  in_reply_to_status_id: z.union([z.string(), z.number()]).nullable().optional(),
  in_reply_to_status_id_str: z.string().nullable().optional(),
  in_reply_to_screen_name: z.string().nullable().optional(),
  text: z.string().optional(),
  full_text: z.string().optional(),
  created_at: z.string().nullable().optional(),
  author_id: z.union([z.string(), z.number()]).nullable().optional(),
  user: XWebhookUserSchema.optional(),
  entities: XTweetEntitiesSchema.optional(),
  extended_tweet: z.object({
    full_text: z.string().optional(),
    entities: XTweetEntitiesSchema.optional(),
  }).passthrough().optional(),
  quoted_status: z.object({
    text: z.string().optional(),
    full_text: z.string().optional(),
    extended_tweet: z.object({
      full_text: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  retweeted_status: z.unknown().optional(),
}).passthrough();

export const XAccountActivityPayloadSchema = z.object({
  for_user_id: z.union([z.string(), z.number()]).optional(),
  is_blocked_by: z.union([z.string(), z.boolean()]).optional(),
  user_has_blocked: z.union([z.string(), z.boolean()]).optional(),
  tweet_create_events: z.array(XWebhookTweetSchema).optional(),
}).passthrough();

type XWebhookTweet = z.infer<typeof XWebhookTweetSchema>;

export type ProcessXWebhookPayloadResult = {
  received: number;
  queued: number;
  skipped: number;
  failed: number;
  runIds: string[];
  errors: Array<{ postId?: string; error: string }>;
};

export type XWebhookDeliveryAttempt = {
  attemptId: string;
  bodySha256: string;
  bytes: number;
  contentType: string | null;
  forUserId: string | null;
  parsed: boolean;
  receivedAt: string;
  signaturePresent: boolean;
  tweetIds: string[];
  userAgent: string | null;
};

export function xWebhookResponseToken(input: {
  crcToken: string;
  consumerSecret?: string;
}): string {
  if (!input.consumerSecret) {
    throw new Error("X webhook CRC requires X_CONSUMER_SECRET.");
  }

  return `sha256=${hmacSha256Base64(input.crcToken, input.consumerSecret)}`;
}

export function verifyXWebhookSignature(input: {
  rawBody: string | Buffer;
  signature: string | null;
  consumerSecret?: string;
}): void {
  if (!input.consumerSecret) {
    throw new Error("X webhook signature verification requires X_CONSUMER_SECRET.");
  }
  if (!input.signature) {
    throw new Error("X webhook request is missing x-twitter-webhooks-signature.");
  }

  const expected = `sha256=${hmacSha256Base64(input.rawBody, input.consumerSecret)}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error("X webhook signature did not match.");
  }
}

function hmacSha256Base64(message: string | Buffer, secret: string): string {
  return createHmac("sha256", secret)
    .update(message)
    .digest("base64");
}

export async function recordXWebhookDeliveryAttempt(input: {
  store: CassieStore;
  rawBody: Buffer;
  headers: Headers;
}): Promise<XWebhookDeliveryAttempt> {
  const parsed = parseXWebhookDeliveryBody(input.rawBody);
  const attempt: XWebhookDeliveryAttempt = {
    attemptId: randomUUID(),
    bodySha256: createHash("sha256").update(input.rawBody).digest("hex"),
    bytes: input.rawBody.byteLength,
    contentType: input.headers.get("content-type"),
    forUserId: parsed.forUserId,
    parsed: parsed.parsed,
    receivedAt: new Date().toISOString(),
    signaturePresent: Boolean(input.headers.get("x-twitter-webhooks-signature")),
    tweetIds: parsed.tweetIds,
    userAgent: input.headers.get("user-agent"),
  };
  await input.store.setRuntimeState(`x_webhook_delivery:${attempt.receivedAt}:${attempt.attemptId}`, attempt);
  return attempt;
}

export async function processXWebhookPayload(input: {
  product: CassieProduct;
  store: CassieStore;
  payload: unknown;
  userId?: string;
  cassieHandle?: string;
}): Promise<ProcessXWebhookPayloadResult> {
  const userId = input.userId ?? runtimeConfig.x.webhookUserId;
  if (!userId) {
    throw new Error("X webhook processing requires X_WEBHOOK_USER_ID.");
  }

  const cassieHandle = input.cassieHandle ?? runtimeConfig.x.cassieHandle;
  if (!cassieHandle) {
    throw new Error("X webhook processing requires CASSIE_X_HANDLE.");
  }

  const payload = XAccountActivityPayloadSchema.parse(input.payload);
  const tweets = payload.tweet_create_events ?? [];
  if (isTruthyXFlag(payload.user_has_blocked) || isTruthyXFlag(payload.is_blocked_by)) {
    return {
      received: tweets.length,
      queued: 0,
      skipped: tweets.length,
      failed: 0,
      runIds: [],
      errors: [],
    };
  }

  const runIds: string[] = [];
  const errors: Array<{ postId?: string; error: string }> = [];
  let skipped = 0;
  let failed = 0;

  for (const tweet of tweets) {
    let postId: string | undefined;
    try {
      if (tweet.retweeted_status != null) {
        skipped += 1;
        continue;
      }

      const mentionPost = sourcePostFromXWebhookTweet(tweet);
      postId = requireSourcePostId(mentionPost);
      if (!mentionsCassie(mentionPost.text, cassieHandle)) {
        skipped += 1;
        continue;
      }
      const sourcePost = sourcePostForAnalysis(tweet, mentionPost);

      const stateKey = `x_webhook:${userId}:${postId}`;
      const existing = await input.store.getRuntimeState(stateKey);
      if (existing != null) {
        skipped += 1;
        continue;
      }

      const result = await input.product.createMentionRun({
        userId,
        userCommand: mentionPost.text,
        sourcePost,
      });
      await input.store.setRuntimeState(`x_reply_target:${result.runId}`, {
        postId,
        url: mentionPost.url,
      });
      await input.store.setRuntimeState(stateKey, {
        runId: result.runId,
        receivedAt: new Date().toISOString(),
      });
      runIds.push(result.runId);
    } catch (error) {
      failed += 1;
      errors.push({
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    received: tweets.length,
    queued: runIds.length,
    skipped,
    failed,
    runIds,
    errors,
  };
}

function parseXWebhookDeliveryBody(rawBody: Buffer): {
  forUserId: string | null;
  parsed: boolean;
  tweetIds: string[];
} {
  try {
    const payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    if (!isRecord(payload)) return { forUserId: null, parsed: false, tweetIds: [] };
    const forUserId = stringValue(payload.for_user_id as string | number | null | undefined);
    const tweetIds = Array.isArray(payload.tweet_create_events)
      ? payload.tweet_create_events
        .map((tweet) => {
          if (!isRecord(tweet)) return null;
          return stringValue((tweet.id_str ?? tweet.id) as string | number | null | undefined);
        })
        .filter((id): id is string => Boolean(id))
      : [];
    return { forUserId, parsed: true, tweetIds };
  } catch {
    return { forUserId: null, parsed: false, tweetIds: [] };
  }
}

function sourcePostForAnalysis(tweet: XWebhookTweet, mentionPost: SourcePost): SourcePost {
  const parentPostId = stringValue(tweet.in_reply_to_status_id_str ?? tweet.in_reply_to_status_id);
  if (!parentPostId) return mentionPost;

  const parentUrl = xStatusUrl(tweet.in_reply_to_screen_name ?? null, parentPostId);
  return {
    platform: "x",
    postId: parentPostId,
    url: parentUrl,
    authorHandle: tweet.in_reply_to_screen_name ?? null,
    authorName: null,
    text: parentUrl,
    createdAt: null,
    quotedPostText: null,
    linkedUrls: [],
    mediaDescriptions: [],
  };
}

function sourcePostFromXWebhookTweet(tweet: XWebhookTweet): SourcePost {
  const postId = stringValue(tweet.id_str ?? tweet.id);
  if (!postId) {
    throw new Error("X webhook tweet_create_events item is missing id_str.");
  }

  const text = tweet.extended_tweet?.full_text ?? tweet.full_text ?? tweet.text;
  if (!text) {
    throw new Error(`X webhook tweet ${postId} is missing text.`);
  }

  const authorHandle = tweet.user?.screen_name ?? tweet.user?.username ?? null;
  const authorName = tweet.user?.name ?? null;
  const entities = tweet.extended_tweet?.entities ?? tweet.entities;

  return {
    platform: "x",
    postId,
    url: xStatusUrl(authorHandle, postId),
    authorHandle,
    authorName,
    text,
    createdAt: tweet.created_at ?? null,
    quotedPostText: tweet.quoted_status
      ? tweet.quoted_status.extended_tweet?.full_text ?? tweet.quoted_status.full_text ?? tweet.quoted_status.text ?? null
      : null,
    linkedUrls: uniqueStrings((entities?.urls ?? [])
      .map((url) => url.unwound?.url ?? url.expanded_url ?? url.url)
      .filter((url): url is string => Boolean(url))),
    mediaDescriptions: [],
  };
}

function xStatusUrl(handle: string | null, postId: string): string {
  return handle ? `https://x.com/${handle}/status/${postId}` : `https://x.com/i/status/${postId}`;
}

function stringValue(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

function mentionsCassie(text: string, cassieHandle: string): boolean {
  const handle = cassieHandle.replace(/^@/, "");
  return new RegExp(`(^|[^A-Za-z0-9_])@${escapeRegExp(handle)}\\b`, "i").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function requireSourcePostId(sourcePost: SourcePost): string {
  if (!sourcePost.postId) {
    throw new Error("X webhook source post is missing postId.");
  }
  return sourcePost.postId;
}

function isTruthyXFlag(value: string | boolean | undefined): boolean {
  return value === true || value === "true";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
