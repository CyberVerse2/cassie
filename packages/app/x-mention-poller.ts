import { CassieProduct } from "./product.ts";
import { processXWebhookPayload } from "./x-webhook.ts";
import { config as runtimeConfig } from "../core/config.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { StructuredAiClient } from "../ai/client.ts";
import { XApiReplyClient, XRecentMentionSearchClient, type XRecentMentionTweet, type XReplyClient } from "../notifications/x.ts";

const X_MENTION_POLL_SINCE_KEY = "x_mention_poll:since_id";

export type PollXCommandMentionsResult = {
  found: number;
  processed: number;
  skipped: number;
  runIds: string[];
  errors: Array<{ postId?: string; error: string }>;
};

export async function pollXCommandMentions(input: {
  store?: CassieStore;
  product?: CassieProduct;
  searchClient?: XRecentMentionSearchClient;
  replyClient?: XReplyClient;
  ai?: StructuredAiClient;
  processInitialBackfill?: boolean;
} = {}): Promise<PollXCommandMentionsResult> {
  const store = input.store ?? new DrizzleCassieStore();
  const product = input.product ?? new CassieProduct(store);
  const searchClient = input.searchClient ?? new XRecentMentionSearchClient();
  const replyClient = input.replyClient ?? new XApiReplyClient(undefined, fetch, store);
  const sinceId = await xMentionPollSinceId(store);
  const { tweets, reseeded } = await searchMentionsForPoll(searchClient, store, sinceId);
  const sortedTweets = [...tweets].sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1);
  const parentTweets = await lookupParentTweets(searchClient, sortedTweets);
  const result: PollXCommandMentionsResult = {
    found: tweets.length,
    processed: 0,
    skipped: 0,
    runIds: [],
    errors: [],
  };

  if ((!sinceId || reseeded) && !input.processInitialBackfill) {
    await storeXMentionPollSinceId(store, sortedTweets.at(-1)?.id);
    result.skipped = tweets.length;
    return result;
  }

  for (const tweet of sortedTweets) {
    const pollStateKey = `x_mention_poll:${tweet.id}`;
    if (await store.getRuntimeState(pollStateKey)) {
      result.skipped += 1;
      continue;
    }

    const processed = await processXWebhookPayload({
      product,
      store,
      cassieHandle: runtimeConfig.x.cassieHandle ?? "cassiedottrade",
      payload: xAccountActivityPayloadFromRecentTweet(tweet, parentTweets.get(replyReferenceId(tweet) ?? "")),
      replyClient,
      ai: input.ai,
    });
    await store.setRuntimeState(pollStateKey, {
      processedAt: new Date().toISOString(),
      result: processed,
    });
    result.processed += 1;
    result.runIds.push(...processed.runIds);
    result.errors.push(...processed.errors);
  }

  const newestId = sortedTweets.at(-1)?.id;
  await storeXMentionPollSinceId(store, newestId);

  return result;
}

async function searchMentionsForPoll(
  searchClient: XRecentMentionSearchClient,
  store: CassieStore,
  sinceId: string | undefined,
): Promise<{ tweets: XRecentMentionTweet[]; reseeded: boolean }> {
  try {
    return {
      tweets: await searchClient.searchCommandMentions({ sinceId }),
      reseeded: false,
    };
  } catch (error) {
    if (!sinceId || !isStaleSinceIdError(error)) throw error;
    const tweets = await searchClient.searchCommandMentions();
    await clearXMentionPollSinceId(store);
    return { tweets, reseeded: true };
  }
}

async function lookupParentTweets(
  searchClient: XRecentMentionSearchClient,
  tweets: XRecentMentionTweet[],
): Promise<Map<string, XRecentMentionTweet>> {
  const parentIds = tweets
    .map(replyReferenceId)
    .filter((id): id is string => Boolean(id));
  return searchClient.lookupTweetsById(parentIds);
}

async function xMentionPollSinceId(store: CassieStore): Promise<string | undefined> {
  const state = await store.getRuntimeState<unknown>(X_MENTION_POLL_SINCE_KEY);
  if (typeof state === "string") return state;
  if (typeof state === "number" && Number.isSafeInteger(state)) return String(state);
  if (isRecord(state) && typeof state.sinceId === "string") return state.sinceId;
  return undefined;
}

async function storeXMentionPollSinceId(store: CassieStore, sinceId: string | undefined): Promise<void> {
  if (!sinceId) return;
  await store.setRuntimeState(X_MENTION_POLL_SINCE_KEY, { sinceId });
}

async function clearXMentionPollSinceId(store: CassieStore): Promise<void> {
  await store.setRuntimeState(X_MENTION_POLL_SINCE_KEY, {
    resetAt: new Date().toISOString(),
  });
}

function isStaleSinceIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("'since_id' must be a tweet id created after");
}

function xAccountActivityPayloadFromRecentTweet(tweet: XRecentMentionTweet, parentTweet?: XRecentMentionTweet) {
  const replyReference = replyReferenceId(tweet);
  return {
    for_user_id: runtimeConfig.x.webhookAccountId,
    tweet_create_events: [{
      id_str: tweet.id,
      author_id: tweet.author_id,
      created_at: tweet.created_at,
      full_text: tweet.text,
      in_reply_to_status_id_str: replyReference,
      user: {
        id_str: tweet.author_id,
        name: tweet.author_name,
        screen_name: tweet.author_username,
      },
      replied_to_status: parentTweet ? {
        id_str: parentTweet.id,
        author_id: parentTweet.author_id,
        created_at: parentTweet.created_at,
        full_text: parentTweet.text,
        user: {
          id_str: parentTweet.author_id,
          name: parentTweet.author_name,
          screen_name: parentTweet.author_username,
        },
      } : undefined,
    }],
  };
}

function replyReferenceId(tweet: XRecentMentionTweet): string | undefined {
  return tweet.referenced_tweets?.find((reference) => reference.type === "replied_to")?.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
