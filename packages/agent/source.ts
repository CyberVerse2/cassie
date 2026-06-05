import { createXai } from "@ai-sdk/xai";
import { Output, generateText } from "ai";
import { z } from "zod";
import { MissingConnectorConfigError } from "../core/helpers/connector-errors.ts";
import { config } from "../core/config.ts";
import {
  SourcePostSchema,
  type SourcePost,
} from "../core/schemas/index.ts";
import type { TraceRecorder } from "../core/trace.ts";
import { configureAiSdkWarningLogging } from "../ai/helpers/sdk-warnings.ts";
import { extractModelThinkingTrace } from "../ai/client.ts";

configureAiSdkWarningLogging();

export interface SourceResolver {
  resolveSource(input: { url: string; onThinkingTrace?: (thinkingTrace: string | null) => void }): Promise<SourcePost>;
}

const GrokSourceResolutionSchema = z.object({
  found: z.boolean(),
  reason: z.string().nullable(),
  sourcePost: SourcePostSchema.nullable(),
});

type GrokSourceResolution = z.infer<typeof GrokSourceResolutionSchema>;

export type XSourceLocator = {
  handle: string | null;
  postId: string;
  canonicalUrl: string;
};

export type GrokSourceGenerationInput = {
  apiKey: string;
  model: string;
  locator: XSourceLocator;
  prompt: string;
  onThinkingTrace?: (thinkingTrace: string | null) => void;
};

export type GrokSourceGenerator = (input: GrokSourceGenerationInput) => Promise<GrokSourceResolution>;

export class GrokXSourceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokXSourceResolutionError";
  }
}

export class GrokXSourceResolver implements SourceResolver {
  constructor(
    private readonly apiKey = config.ai.xAiApiKey,
    private readonly model = config.ai.grokXSearchModel,
    private readonly trace?: TraceRecorder,
    private readonly generate: GrokSourceGenerator = generateGrokSourceResolution,
  ) {}

  async resolveSource(input: {
    url: string;
    onThinkingTrace?: (thinkingTrace: string | null) => void;
  }): Promise<SourcePost> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Grok X source resolver", "XAI_API_KEY");
    }

    const locator = parseXStatusUrl(input.url);
    const prompt = buildGrokSourceResolutionPrompt(locator);
    const finishTrace = this.trace?.start({
      name: "resolve_source",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Resolving the exact X status URL into Cassie's SourcePost shape before opportunity framing.",
      input: locator,
    });

    try {
      const resolution = await this.generate({
        apiKey: this.apiKey,
        model: this.model,
        locator,
        prompt,
        onThinkingTrace: input.onThinkingTrace,
      });
      if (!resolution.found || !resolution.sourcePost) {
        throw new GrokXSourceResolutionError(
          resolution.reason ?? `Grok could not resolve X post ${locator.canonicalUrl}.`,
        );
      }

      const resolvedHandle = resolution.sourcePost.authorHandle ?? locator.handle;
      const resolvedPostId = resolution.sourcePost.postId ?? locator.postId;
      const sourcePost = SourcePostSchema.parse({
        ...resolution.sourcePost,
        postId: resolvedPostId,
        url: xStatusUrl(resolvedHandle, resolvedPostId, resolution.sourcePost.url ?? locator.canonicalUrl),
        authorHandle: resolvedHandle,
      });
      finishTrace?.({
        output: {
          postId: sourcePost.postId,
          url: sourcePost.url,
          authorHandle: sourcePost.authorHandle,
          text: sourcePost.text,
          linkedUrls: sourcePost.linkedUrls ?? [],
          mediaDescriptions: sourcePost.mediaDescriptions ?? [],
        },
      });
      return sourcePost;
    } catch (error) {
      finishTrace?.({ error });
      throw error;
    }
  }
}

function xStatusUrl(handle: string | null, postId: string, fallback: string): string {
  return handle ? `https://x.com/${handle}/status/${postId}` : fallback;
}

export async function generateGrokSourceResolution(
  input: GrokSourceGenerationInput,
): Promise<GrokSourceResolution> {
  const xai = createXai({ apiKey: input.apiKey });
  const result = await generateText({
    model: xai.responses(input.model),
    output: Output.object({
      schema: GrokSourceResolutionSchema,
      name: "cassie_grok_source_resolution",
    }),
    tools: {
      x_search: xai.tools.xSearch({
        allowedXHandles: input.locator.handle ? [input.locator.handle] : undefined,
        enableImageUnderstanding: true,
        enableVideoUnderstanding: true,
      }),
    },
    toolChoice: "required",
    prompt: input.prompt,
    maxRetries: config.structuredAi.maxRetries,
  });

  input.onThinkingTrace?.(extractModelThinkingTrace(result));
  return result.output;
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

export function buildGrokSourceResolutionPrompt(locator: XSourceLocator): string {
  return [
    "Resolve this exact X/Twitter status into Cassie's SourcePost schema before any trading analysis.",
    "",
    `Canonical URL: ${locator.canonicalUrl}`,
    `Status ID: ${locator.postId}`,
    `Expected handle from URL: ${locator.handle ?? "unknown"}`,
    "",
    "Role:",
    "Exact X source resolver. Find the requested status and copy visible SourcePost fields; do not perform market analysis.",
    "",
    "When uncertain:",
    "- If exact identity cannot be verified, return found=false with a concrete reason and sourcePost=null.",
    "- If a field is not visible on the resolved post, use null or an empty array rather than inferring it.",
    "",
    "Use the x_search tool to find the exact post. Match the status ID and URL, not just a similar post or topic.",
    "Return found=false with a concise reason if the exact post is unavailable, deleted, private, blocked, or cannot be verified.",
    "",
    "For sourcePost, copy only facts available from the resolved post or its visible metadata:",
    "- platform must be x.",
    "- text must be the post text exactly as available.",
    "- authorHandle, authorName, createdAt, linkedUrls, mediaDescriptions, and quotedPostText must come from the resolved post or visible attached content.",
    "- Use null or an empty array for fields that are not available from the resolved post.",
    "",
    "Examples:",
    "- If x_search resolves the exact status ID and visible author/post metadata, return found=true and copy only those visible fields.",
    "- If x_search finds the same topic from the same author but a different status ID, return found=false because the exact post was not verified.",
    "- If the exact post is deleted, private, blocked, rate-limited, or unavailable, return found=false with the concrete reason.",
    "",
    "Before returning, verify internally:",
    "- The resolved status ID equals the requested Status ID.",
    "- The URL and handle match the canonical URL when visible, or reason explains the mismatch.",
    "- text is copied from the post exactly as available.",
    "- unavailable fields are null or empty arrays.",
    "- sourcePost contains no trading analysis, market inference, or invented metadata.",
    "",
    "Do not infer, summarize, embellish, or invent post text, authors, timestamps, URLs, media descriptions, quoted-post text, markets, tickers, prices, probabilities, liquidity, listings, or contract rules.",
  ].join("\n");
}
