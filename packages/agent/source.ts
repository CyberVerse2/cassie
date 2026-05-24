import { z } from "zod";
import { readJsonResponse, MissingConnectorConfigError } from "../core/helpers/index.ts";
import { config } from "../core/config.ts";
import { SourcePostSchema, type SourcePost } from "../core/schemas/index.ts";

export interface SourceResolver {
  resolveSource(input: { url: string }): Promise<SourcePost>;
}

const XTweetLookupSchema = z.object({
  data: z.object({
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
  }),
  includes: z.object({
    users: z.array(z.object({
      id: z.string(),
      username: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })).optional(),
  }).optional(),
});

export class XApiSourceResolver implements SourceResolver {
  constructor(
    private readonly bearerToken = config.xPolling.bearerToken,
    private readonly endpoint = "https://api.x.com/2/tweets",
  ) {}

  async resolveSource(input: { url: string }): Promise<SourcePost> {
    if (!this.bearerToken) {
      throw new MissingConnectorConfigError("X source resolver", "X_BEARER_TOKEN");
    }

    const locator = parseXStatusUrl(input.url);
    const url = new URL(`${this.endpoint}/${locator.postId}`);
    url.searchParams.set("tweet.fields", "created_at,author_id,entities");
    url.searchParams.set("expansions", "author_id");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
      },
    });
    const payload = XTweetLookupSchema.parse(await readJsonResponse("X tweet lookup", response));
    const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
    const author = payload.data.author_id ? users.get(payload.data.author_id) : undefined;

    return SourcePostSchema.parse({
      platform: "x",
      postId: payload.data.id,
      url: author?.username
        ? `https://x.com/${author.username}/status/${payload.data.id}`
        : locator.canonicalUrl,
      authorHandle: author?.username ?? locator.handle,
      authorName: author?.name ?? null,
      text: payload.data.text,
      createdAt: payload.data.created_at ?? null,
      linkedUrls: (payload.data.entities?.urls ?? [])
        .map((candidate) => candidate.expanded_url ?? candidate.url)
        .filter((candidate): candidate is string => Boolean(candidate)),
    });
  }
}

export function parseXStatusUrl(tweetUrl: string): {
  handle: string | null;
  postId: string;
  canonicalUrl: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(tweetUrl);
  } catch {
    throw new Error(`Invalid X post URL: ${tweetUrl}`);
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") {
    throw new Error(`Expected an x.com or twitter.com URL, got ${parsed.hostname}.`);
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => part === "status" || part === "statuses");
  const handle = statusIndex > 0 ? parts[statusIndex - 1] ?? null : null;
  const postId = statusIndex >= 0 ? parts[statusIndex + 1] : undefined;
  if (!postId || !/^\d+$/.test(postId)) {
    throw new Error(`Could not find a numeric X status ID in ${tweetUrl}.`);
  }

  return {
    handle,
    postId,
    canonicalUrl: handle ? `https://x.com/${handle}/status/${postId}` : `https://x.com/i/status/${postId}`,
  };
}
