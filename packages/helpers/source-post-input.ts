import type { SourcePost } from "../core/schemas/index.ts";
import type { SourceResolver } from "../agent/source.ts";
import { selectNextTweetUrl } from "./tweet-round-robin.ts";

export async function sourcePostFromInput(input: {
  sourceResolver: SourceResolver;
  tweetUrl?: string | null;
  tweetsFile?: string | null;
  postText?: string | null;
  postId?: string | null;
  url?: string | null;
  authorHandle?: string | null;
  authorName?: string | null;
  createdAt?: string | null;
  quotedPostText?: string | null;
  linkedUrls?: string[];
  mediaDescriptions?: string[];
  defaultPostText?: string | null;
}): Promise<SourcePost> {
  if (input.tweetUrl && input.postText != null) {
    throw new Error("Use either --tweet-url or --post, not both.");
  }

  if (input.tweetUrl) {
    return input.sourceResolver.resolveSource({ url: input.tweetUrl });
  }

  const postText = input.postText ?? input.defaultPostText;
  if (postText != null) {
    return inlineSourcePost(input, postText);
  }

  const selectedUrl = await selectNextTweetUrl(input.tweetsFile ?? undefined);
  return input.sourceResolver.resolveSource({ url: selectedUrl });
}

function inlineSourcePost(
  input: {
    postId?: string | null;
    url?: string | null;
    authorHandle?: string | null;
    authorName?: string | null;
    createdAt?: string | null;
    quotedPostText?: string | null;
    linkedUrls?: string[];
    mediaDescriptions?: string[];
  },
  text: string,
): SourcePost {
  return {
    platform: "x",
    postId: input.postId ?? null,
    url: input.url ?? null,
    authorHandle: input.authorHandle ?? "local-test",
    authorName: input.authorName ?? "Local Test",
    text,
    createdAt: input.createdAt ?? null,
    quotedPostText: input.quotedPostText ?? null,
    linkedUrls: input.linkedUrls ?? [],
    mediaDescriptions: input.mediaDescriptions ?? [],
  };
}
