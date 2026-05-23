import { z } from "zod";
import type { SourcePost } from "../core/schemas/index.ts";
import type { CassieStore } from "../db/store.ts";
import { readJsonResponse } from "../core/connector-errors.ts";
import { config as runtimeConfig } from "../core/config.ts";
import type { CassieProduct } from "./product.ts";

const XRecentSearchSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    text: z.string(),
    author_id: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    entities: z.object({
      urls: z.array(z.object({
        expanded_url: z.string().optional(),
        url: z.string().optional(),
      })).optional(),
    }).optional(),
  })).optional(),
  includes: z.object({
    users: z.array(z.object({
      id: z.string(),
      username: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })).optional(),
  }).optional(),
  meta: z.object({
    newest_id: z.string().optional(),
  }).optional(),
});

type XRecentSearch = z.infer<typeof XRecentSearchSchema>;

export class XPollingClient {
  constructor(
    private readonly config = runtimeConfig.xPolling,
  ) {}

  async fetchMentions(input: { sinceId?: string | null }): Promise<XRecentSearch> {
    if (!this.config.bearerToken) {
      throw new Error("X polling requires X_BEARER_TOKEN.");
    }
    if (!this.config.cassieHandle) {
      throw new Error("X polling requires CASSIE_X_HANDLE.");
    }

    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.searchParams.set("query", `@${this.config.cassieHandle} -is:retweet`);
    url.searchParams.set("tweet.fields", "created_at,author_id,entities");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("max_results", String(this.config.maxResults));
    if (input.sinceId) {
      url.searchParams.set("since_id", input.sinceId);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.bearerToken}`,
      },
    });

    return XRecentSearchSchema.parse(await readJsonResponse("X recent search", response));
  }
}

export async function pollXMentions(input: {
  product: CassieProduct;
  store: CassieStore;
  userId: string;
  client?: XPollingClient;
}) {
  const stateKey = `x_poll:${input.userId}`;
  const state = await input.store.getRuntimeState<{ sinceId?: string }>(stateKey);
  const payload = await (input.client ?? new XPollingClient()).fetchMentions({
    sinceId: state?.sinceId ?? null,
  });
  const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
  const tweets = [...(payload.data ?? [])].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  const results = [];

  for (const tweet of tweets) {
    const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
    const sourcePost: SourcePost = {
      platform: "x",
      postId: tweet.id,
      url: `https://x.com/${author?.username ?? "i"}/status/${tweet.id}`,
      authorHandle: author?.username ?? null,
      authorName: author?.name ?? null,
      text: tweet.text,
      createdAt: tweet.created_at ?? null,
      linkedUrls: (tweet.entities?.urls ?? [])
        .map((url) => url.expanded_url ?? url.url)
        .filter((url): url is string => Boolean(url)),
    };

    results.push(await input.product.createMentionRun({
      userId: input.userId,
      userCommand: tweet.text,
      sourcePost,
    }));
  }

  const newestId = payload.meta?.newest_id ?? tweets.at(-1)?.id ?? state?.sinceId;
  if (newestId && newestId !== state?.sinceId) {
    await input.store.setRuntimeState(stateKey, { sinceId: newestId });
  }

  return { queued: results.length, newestId: newestId ?? null, results };
}
