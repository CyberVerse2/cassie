import type {
  ResearchQueryPlan,
  ResearchSearchLanes,
  SearchLaneResult,
} from "../tools/research.ts";
import { MissingConnectorConfigError } from "./errors.ts";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import type { TraceRecorder } from "../trace.ts";

type SearchSource = {
  title?: string;
  url?: string;
};

export class OpenAiWebSearchLane {
  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY,
    private readonly model = process.env.OPENAI_WEB_SEARCH_MODEL ?? "gpt-5",
    private readonly trace?: TraceRecorder,
  ) {}

  async run(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("OpenAI/Web Search lane", "OPENAI_API_KEY");
    }

    const prompt = buildExternalVerificationPrompt(queryPlan);
    const finishTrace = this.trace?.start({
      name: "openai_web_search",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Searching external web sources for primary evidence, contradictions, and recency checks.",
      input: {
        claim: queryPlan.normalizedClaim,
        queries: queryPlan.openAiQueries,
      },
    });

    try {
      const result = await generateText({
        model: openai.responses(this.model),
        tools: {
          web_search: openai.tools.webSearch({ searchContextSize: "medium" }),
        },
        toolChoice: "auto",
        prompt,
      });
      const output = {
        lane: "openai_search" as const,
        evidence: evidenceFromSources("openai_search", result.text, result.sources),
        warnings: [],
      };
      finishTrace?.({
        output: {
          evidenceCount: output.evidence.length,
          sourceCount: result.sources.length,
          summary: result.text,
        },
        usage: result.totalUsage,
      });
      return output;
    } catch (error) {
      finishTrace?.({ error });
      throw error;
    }
  }
}

export class GrokXSearchLane {
  constructor(
    private readonly apiKey = process.env.XAI_API_KEY,
    private readonly model = process.env.GROK_X_SEARCH_MODEL ?? "grok-4",
    private readonly trace?: TraceRecorder,
  ) {}

  async run(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Grok X Search lane", "XAI_API_KEY");
    }

    const xai = createXai({ apiKey: this.apiKey });
    const prompt = buildXSearchPrompt(queryPlan);
    const finishTrace = this.trace?.start({
      name: "grok_x_search",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Searching X for origin posts, refutations, social momentum, and coordinated-push signals.",
      input: {
        claim: queryPlan.normalizedClaim,
        queries: queryPlan.xQueries,
      },
    });

    try {
      const result = await generateText({
        model: xai.responses(this.model),
        tools: {
          x_search: xai.tools.xSearch({
            enableImageUnderstanding: true,
            enableVideoUnderstanding: false,
          }),
        },
        toolChoice: "auto",
        prompt,
      });
      const output = {
        lane: "x_search" as const,
        evidence: evidenceFromXSearch(result.text, result.toolResults),
        warnings: [],
      };
      finishTrace?.({
        output: {
          evidenceCount: output.evidence.length,
          toolResultCount: result.toolResults.length,
          summary: result.text,
        },
        usage: result.totalUsage,
      });
      return output;
    } catch (error) {
      finishTrace?.({ error });
      throw error;
    }
  }
}

export class LiveResearchSearchLanes implements ResearchSearchLanes {
  constructor(
    private readonly openAiLane = new OpenAiWebSearchLane(),
    private readonly grokLane = new GrokXSearchLane(),
  ) {}

  runOpenAiWebSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.openAiLane.run(queryPlan);
  }

  runGrokXSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.grokLane.run(queryPlan);
  }
}

function buildExternalVerificationPrompt(queryPlan: ResearchQueryPlan): string {
  return `You are Cassie's external verification lane for a trading research workflow.

Verify this market claim using web sources.

Claim: ${queryPlan.normalizedClaim}
Assets: ${queryPlan.assets.join(", ")}
Topics: ${queryPlan.topics.join(", ")}

Search goals:
- Find official, regulatory, company, exchange, and reputable news sources.
- Find contradictions and refutations.
- Identify whether this is old news being recirculated.
- Prefer primary sources over commentary.
- Return concise evidence with citations, and separate facts from market interpretation.`;
}

function buildXSearchPrompt(queryPlan: ResearchQueryPlan): string {
  return `Investigate this market narrative on X.

Claim: ${queryPlan.normalizedClaim}
X queries:
${queryPlan.xQueries.map((query) => `- ${query}`).join("\n")}

Look for:
- origin accounts or posts
- credible accounts discussing it
- refutations
- recycled screenshots or links
- social crowding
- promotional or coordinated language

X social momentum is not proof of truth.`;
}

function evidenceFromSources(
  sourceLane: "openai_search",
  summary: string,
  sources: SearchSource[],
) {
  if (sources.length === 0) {
    return [
      {
        sourceLane,
        sourceType: "unknown" as const,
        title: null,
        url: null,
        author: null,
        publishedAt: null,
        summary,
        stance: "unclear" as const,
        reliability: "medium" as const,
        relevance: 0.7,
        notes: null,
      },
    ];
  }

  return sources.map((source) => ({
    sourceLane,
    sourceType: "unknown" as const,
    title: source.title ?? null,
    url: source.url ?? null,
    author: null,
    publishedAt: null,
    summary,
    stance: "unclear" as const,
    reliability: "medium" as const,
    relevance: 0.8,
    notes: null,
  }));
}

function evidenceFromXSearch(summary: string, toolResults: unknown[]) {
  const posts = toolResults.flatMap((result) => extractXPosts(result));
  if (posts.length === 0) {
    return [
      {
        sourceLane: "x_search" as const,
        sourceType: "social" as const,
        title: null,
        url: null,
        author: null,
        publishedAt: null,
        summary,
        stance: "unclear" as const,
        reliability: "medium" as const,
        relevance: 0.7,
        notes: null,
      },
    ];
  }

  return posts.map((post) => ({
    sourceLane: "x_search" as const,
    sourceType: "social" as const,
    title: post.author ? `X post by ${post.author}` : "X post",
    url: post.url ?? null,
    author: post.author ?? null,
    publishedAt: null,
    summary: post.text ? `${summary}\n\nPost: ${post.text}` : summary,
    stance: "unclear" as const,
    reliability: "medium" as const,
    relevance: 0.75,
    notes: Number.isFinite(post.likes) ? [`likes: ${post.likes}`] : null,
  }));
}

function extractXPosts(result: unknown): Array<{
  author?: string;
  text?: string;
  url?: string;
  likes?: number;
}> {
  if (!result || typeof result !== "object") return [];
  const maybeOutput = "output" in result ? result.output : result;
  if (!maybeOutput || typeof maybeOutput !== "object" || !("posts" in maybeOutput)) return [];
  const posts = maybeOutput.posts;
  if (!Array.isArray(posts)) return [];

  return posts.filter((post): post is {
    author?: string;
    text?: string;
    url?: string;
    likes?: number;
  } => Boolean(post) && typeof post === "object");
}
