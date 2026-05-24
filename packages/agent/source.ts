import { createXai } from "@ai-sdk/xai";
import { Output, generateText } from "ai";
import { z } from "zod";
import { MissingConnectorConfigError } from "../core/helpers/index.ts";
import { config } from "../core/config.ts";
import {
  ExpressionFitAssessmentSchema,
  MarketCandidateSchema,
  OpportunityFrameSchema,
  SourcePostSchema,
  TradeExpressionPlanSchema,
  XSentimentAssessmentSchema,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type OpportunityFrame,
  type SourcePost,
  type TradeExpressionPlan,
  type XSentimentAssessment,
} from "../core/schemas/index.ts";
import type { TraceRecorder } from "../core/trace.ts";
import { configureAiSdkWarningLogging } from "../ai/helpers/index.ts";
import { extractModelThinkingTrace } from "../ai/client.ts";

configureAiSdkWarningLogging();

export interface SourceResolver {
  resolveSource(input: { url: string; onThinkingTrace?: (thinkingTrace: string | null) => void }): Promise<SourcePost>;
}

export interface XSentimentProvider {
  checkXSentiment(input: {
    sourcePost: SourcePost;
    opportunityFrame: OpportunityFrame;
    tradeExpression: TradeExpressionPlan | null;
    fitAssessment: ExpressionFitAssessment | null;
    candidate: MarketCandidate | null;
    onThinkingTrace?: (thinkingTrace: string | null) => void;
  }): Promise<XSentimentAssessment>;
}

const GrokSourceResolutionSchema = z.object({
  found: z.boolean(),
  reason: z.string().nullable(),
  sourcePost: SourcePostSchema.nullable(),
});

const GrokXSentimentInputSchema = z.object({
  sourcePost: SourcePostSchema,
  opportunityFrame: OpportunityFrameSchema,
  tradeExpression: TradeExpressionPlanSchema.nullable().default(null),
  fitAssessment: ExpressionFitAssessmentSchema.nullable().default(null),
  candidate: MarketCandidateSchema.nullable().default(null),
});

type GrokSourceResolution = z.infer<typeof GrokSourceResolutionSchema>;
type GrokXSentimentInput = z.infer<typeof GrokXSentimentInputSchema>;

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

export type GrokXSentimentGenerationInput = GrokXSentimentInput & {
  apiKey: string;
  model: string;
  prompt: string;
  onThinkingTrace?: (thinkingTrace: string | null) => void;
};

export type GrokXSentimentGenerator = (input: GrokXSentimentGenerationInput) => Promise<XSentimentAssessment>;

export class GrokXSourceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokXSourceResolutionError";
  }
}

export class GrokXSentimentProvider implements XSentimentProvider {
  constructor(
    private readonly apiKey = config.ai.xAiApiKey,
    private readonly model = config.ai.grokXSearchModel,
    private readonly trace?: TraceRecorder,
    private readonly generate: GrokXSentimentGenerator = generateGrokXSentiment,
  ) {}

  async checkXSentiment(input: {
    sourcePost: SourcePost;
    opportunityFrame: OpportunityFrame;
    tradeExpression: TradeExpressionPlan | null;
    fitAssessment: ExpressionFitAssessment | null;
    candidate: MarketCandidate | null;
    onThinkingTrace?: (thinkingTrace: string | null) => void;
  }): Promise<XSentimentAssessment> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Grok X sentiment checker", "XAI_API_KEY");
    }

    const parsed = GrokXSentimentInputSchema.parse(input);
    const prompt = buildGrokXSentimentPrompt(parsed);
    const finishTrace = this.trace?.start({
      name: "check_x_sentiment",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Checking X-only sentiment, novelty, crowding, and correction risk before expression ranking.",
      input: parsed,
    });

    try {
      const sentiment = XSentimentAssessmentSchema.parse(await this.generate({
        ...parsed,
        apiKey: this.apiKey,
        model: this.model,
        prompt,
        onThinkingTrace: input.onThinkingTrace,
      }));
      finishTrace?.({
        output: {
          status: sentiment.status,
          sentimentDirection: sentiment.sentimentDirection,
          attentionLevel: sentiment.attentionLevel,
          novelty: sentiment.novelty,
          crowdingRisk: sentiment.crowdingRisk,
          correctionRisk: sentiment.correctionRisk,
          evidenceCount: sentiment.evidence.length,
        },
      });
      return sentiment;
    } catch (error) {
      finishTrace?.({ error });
      throw error;
    }
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

      const sourcePost = SourcePostSchema.parse({
        ...resolution.sourcePost,
        postId: resolution.sourcePost.postId ?? locator.postId,
        url: resolution.sourcePost.url ?? locator.canonicalUrl,
        authorHandle: resolution.sourcePost.authorHandle ?? locator.handle,
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

export async function generateGrokXSentiment(
  input: GrokXSentimentGenerationInput,
): Promise<XSentimentAssessment> {
  const xai = createXai({ apiKey: input.apiKey });
  const result = await generateText({
    model: xai.responses(input.model),
    output: Output.object({
      schema: XSentimentAssessmentSchema,
      name: "cassie_x_sentiment",
    }),
    tools: {
      x_search: xai.tools.xSearch({
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
    "Use the x_search tool to find the exact post. Match the status ID and URL, not just a similar post or topic.",
    "Return found=false with a concise reason if the exact post is unavailable, deleted, private, blocked, or cannot be verified.",
    "",
    "For sourcePost, copy only facts available from the resolved post or its visible metadata:",
    "- platform must be x.",
    "- text must be the post text exactly as available.",
    "- authorHandle, authorName, createdAt, linkedUrls, mediaDescriptions, and quotedPostText must come from the resolved post or visible attached content.",
    "- Use null or an empty array for fields that are not available from the resolved post.",
    "",
    "Do not infer, summarize, embellish, or invent post text, authors, timestamps, URLs, media descriptions, quoted-post text, markets, tickers, prices, probabilities, liquidity, listings, or contract rules.",
  ].join("\n");
}

export function buildGrokXSentimentPrompt(input: GrokXSentimentInput): string {
  return [
    "Check X-only social sentiment for the framed opportunity before trade-expression generation.",
    "",
    "Use the x_search tool. Do not use generic web search. Do not use keyword counts, regex, or deterministic term overlap as a substitute for semantic judgment.",
    "Assess current X conversation around the source claim, affected asset/event, market implication, and credible corrections or disagreement.",
    "If trade-expression, fit, or candidate context is supplied, use it only as additional context; do not require it.",
    "",
    "Source post:",
    JSON.stringify({
      url: input.sourcePost.url,
      text: input.sourcePost.text,
      authorName: input.sourcePost.authorName,
      createdAt: input.sourcePost.createdAt,
      quotedPostText: input.sourcePost.quotedPostText,
      linkedUrls: input.sourcePost.linkedUrls,
      mediaDescriptions: input.sourcePost.mediaDescriptions,
    }, null, 2),
    "",
    "Framed opportunity:",
    JSON.stringify(input.opportunityFrame, null, 2),
    "",
    "Trade expression context:",
    JSON.stringify(input.tradeExpression, null, 2),
    "",
    "Fit assessment context:",
    JSON.stringify(input.fitAssessment, null, 2),
    "",
    "Candidate context:",
    JSON.stringify(input.candidate, null, 2),
    "",
    "Return an XSentimentAssessment.",
    "- sourcesChecked must be [\"x\"].",
    "- status must be insufficient_evidence if X search does not produce enough relevant posts to judge sentiment, novelty, crowding, or corrections.",
    "- sentimentDirection describes the X reaction to the trade thesis, not whether the thesis is objectively true.",
    "- attentionLevel and novelty should reflect whether the claim appears newly noticed or already widely circulated on X.",
    "- crowdingRisk should reflect one-sided positioning or hype risk visible on X.",
    "- correctionRisk should reflect credible rebuttals, clarifications, contradictory posts, or evidence that the source claim is stale or misleading.",
    "- Evidence must contain only visible X posts or visible X metadata returned by x_search. Include URLs when available. Use authorName, not handles.",
    "- Do not invent posts, authors, timestamps, engagement, sentiment, prices, tickers, markets, probabilities, liquidity, listings, or contract rules.",
  ].join("\n");
}
