// Backfills sourcePost.mediaUrls on control runs that predate media capture
// in the X webhook. Looks tweets up in batches via the X API v2 and writes
// the image URLs back into the stored source post. Idempotent: runs whose
// source post already has a mediaUrls array (even empty) are skipped, and
// unavailable tweets are marked with [] so they are not refetched.
//
// Usage: npx tsx scripts/backfill-source-media.ts

import "dotenv/config";
import { eq } from "drizzle-orm";
import { config } from "../packages/core/config.ts";
import { createCassieDb } from "../packages/core/db/client.ts";
import { controlRuns } from "../packages/core/db/schema.ts";
import type { SourcePost } from "../packages/core/schemas/index.ts";

const TWEET_LOOKUP_BATCH = 100;

type XMediaObject = {
  media_key?: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
};

type XTweetLookupResponse = {
  data?: Array<{
    id: string;
    attachments?: { media_keys?: string[] };
  }>;
  includes?: { media?: XMediaObject[] };
  errors?: Array<{ resource_id?: string; title?: string }>;
};

async function lookupTweetMedia(
  ids: string[],
  bearerToken: string,
): Promise<Map<string, string[]>> {
  const url = new URL("https://api.x.com/2/tweets");
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("expansions", "attachments.media_keys");
  url.searchParams.set("media.fields", "url,preview_image_url,type");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `X tweet lookup failed (${response.status}): ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as XTweetLookupResponse;

  const mediaByKey = new Map(
    (payload.includes?.media ?? [])
      .filter((media) => media.media_key)
      .map((media) => [media.media_key as string, media]),
  );
  const byTweetId = new Map<string, string[]>();
  // Every requested id gets an entry — found tweets map to their media (or
  // []), errored/deleted tweets to [] — so callers can mark them as fetched.
  for (const id of ids) byTweetId.set(id, []);
  for (const tweet of payload.data ?? []) {
    const urls = (tweet.attachments?.media_keys ?? [])
      .map((key) => mediaByKey.get(key))
      .map((media) =>
        media?.type === "photo"
          ? media.url
          : media?.preview_image_url ?? media?.url,
      )
      .filter((value): value is string => Boolean(value));
    byTweetId.set(tweet.id, [...new Set(urls)]);
  }
  return byTweetId;
}

async function main() {
  const bearerToken = config.x.bearerToken;
  if (!bearerToken) {
    throw new Error("X_BEARER_TOKEN is required to backfill tweet media.");
  }

  const db = createCassieDb();
  const rows = await db
    .select({ runId: controlRuns.runId, sourcePost: controlRuns.sourcePost })
    .from(controlRuns);

  const pending = rows.filter(
    (row) =>
      row.sourcePost.platform === "x" &&
      row.sourcePost.postId &&
      row.sourcePost.mediaUrls === undefined,
  );
  console.log(
    `${rows.length} control runs; ${pending.length} need a media lookup.`,
  );
  if (pending.length === 0) return;

  const postIds = [
    ...new Set(pending.map((row) => row.sourcePost.postId as string)),
  ];
  const mediaByTweetId = new Map<string, string[]>();
  for (let start = 0; start < postIds.length; start += TWEET_LOOKUP_BATCH) {
    const batch = postIds.slice(start, start + TWEET_LOOKUP_BATCH);
    const found = await lookupTweetMedia(batch, bearerToken);
    for (const [id, urls] of found) mediaByTweetId.set(id, urls);
    console.log(
      `Looked up ${Math.min(start + TWEET_LOOKUP_BATCH, postIds.length)}/${postIds.length} tweets…`,
    );
  }

  let withMedia = 0;
  for (const row of pending) {
    const mediaUrls = mediaByTweetId.get(row.sourcePost.postId as string) ?? [];
    if (mediaUrls.length > 0) withMedia += 1;
    const sourcePost: SourcePost = { ...row.sourcePost, mediaUrls };
    await db
      .update(controlRuns)
      .set({ sourcePost, updatedAt: new Date().toISOString() })
      .where(eq(controlRuns.runId, row.runId));
  }
  console.log(
    `Updated ${pending.length} runs; ${withMedia} now carry image URLs.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
