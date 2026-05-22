import { createXai } from "@ai-sdk/xai";
import { Output, generateText } from "ai";
import { z } from "zod";
import { MissingConnectorConfigError } from "../../packages/core/connector-errors.ts";
import { SourcePostSchema, type SourcePost } from "../../packages/core/schemas/index.ts";
import type { TraceRecorder } from "../../packages/core/trace.ts";
import { configureAiSdkWarningLogging } from "../../packages/ai/sdk-warnings.ts";

configureAiSdkWarningLogging();

const XPostResolutionSchema = z.object({
  found: z.boolean(),
  reason: z.string().nullable(),
  sourcePost: SourcePostSchema.nullable(),
});

export type XPostLocator = {
  handle: string | null;
  postId: string;
  canonicalUrl: string;
};

export class XPostResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XPostResolutionError";
  }
}

export class GrokXPostResolver {
  constructor(
    private readonly apiKey = process.env.XAI_API_KEY,
    private readonly model = process.env.GROK_X_SEARCH_MODEL ?? "grok-4.3",
    private readonly trace?: TraceRecorder,
  ) {}

  async resolve(tweetUrl: string): Promise<SourcePost> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Grok X post resolver", "XAI_API_KEY");
    }

    const locator = parseXPostUrl(tweetUrl);
    const xai = createXai({ apiKey: this.apiKey });
    const finishTrace = this.trace?.start({
      name: "resolve_x_post",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Resolving the exact X status URL into Cassie's SourcePost shape before reasoning.",
      input: locator,
    });

    try {
      const result = await generateText({
        model: xai.responses(this.model),
        output: Output.object({
          schema: XPostResolutionSchema,
          name: "cassie_x_post_resolution",
        }),
        tools: {
          x_search: xai.tools.xSearch({
            allowedXHandles: locator.handle ? [locator.handle] : undefined,
            enableImageUnderstanding: true,
            enableVideoUnderstanding: true,
          }),
        },
        prompt: buildXPostResolutionPrompt(locator),
      });

      const resolution = result.output;
      if (!resolution.found || !resolution.sourcePost) {
        throw new XPostResolutionError(
          resolution.reason ?? `Grok could not resolve X post ${locator.canonicalUrl}.`,
        );
      }

      const sourcePost = {
        ...resolution.sourcePost,
        postId: resolution.sourcePost.postId ?? locator.postId,
        url: resolution.sourcePost.url ?? locator.canonicalUrl,
        authorHandle: resolution.sourcePost.authorHandle ?? locator.handle,
      };
      finishTrace?.({
        output: {
          postId: sourcePost.postId,
          url: sourcePost.url,
          authorHandle: sourcePost.authorHandle,
          text: sourcePost.text,
          linkedUrls: sourcePost.linkedUrls ?? [],
          mediaDescriptions: sourcePost.mediaDescriptions ?? [],
        },
        usage: result.totalUsage,
      });
      return sourcePost;
    } catch (error) {
      finishTrace?.({ error });
      throw error;
    }
  }
}

export function parseXPostUrl(tweetUrl: string): XPostLocator {
  let parsed: URL;
  try {
    parsed = new URL(tweetUrl);
  } catch {
    throw new XPostResolutionError(`Invalid X post URL: ${tweetUrl}`);
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") {
    throw new XPostResolutionError(`Expected an x.com or twitter.com URL, got ${parsed.hostname}.`);
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => part === "status" || part === "statuses");
  const handle = statusIndex > 0 ? parts[statusIndex - 1] ?? null : null;
  const postId = statusIndex >= 0 ? parts[statusIndex + 1] : undefined;

  if (!postId || !/^\d+$/.test(postId)) {
    throw new XPostResolutionError(`Could not find a numeric X status ID in ${tweetUrl}.`);
  }

  return {
    handle,
    postId,
    canonicalUrl: handle ? `https://x.com/${handle}/status/${postId}` : `https://x.com/i/status/${postId}`,
  };
}

export function buildXPostResolutionPrompt(locator: XPostLocator): string {
  return `You are Cassie's X post resolver.

Use X Search to resolve the exact target post below. Do not answer from memory.
Fill the structured response schema directly.

Target URL: ${locator.canonicalUrl}
Target status ID: ${locator.postId}
Target handle: ${locator.handle ?? "unknown"}

If found, preserve the author's meaning and include only URLs/media directly attached to the target post.
If the exact target post cannot be found, set found false, sourcePost null, and give a brief reason.
Only resolve the target post. Do not include unrelated search results.`;
}
