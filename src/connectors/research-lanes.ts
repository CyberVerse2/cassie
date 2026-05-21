import type {
  ResearchSearchLanes,
  SearchLaneResult,
} from "../tools/research.ts";
import type { ResearchGoal, ResearchQueryPlan } from "../schemas.ts";
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
        goals: goalsForLane(queryPlan, "web"),
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
        goals: goalsForLane(queryPlan, "x"),
      },
    });

    try {
      const result = await generateText({
        model: xai.responses(this.model),
        tools: {
          x_search: xai.tools.xSearch({
            enableImageUnderstanding: true,
            enableVideoUnderstanding: true,
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
Source author: ${queryPlan.sourceHandle ? `@${queryPlan.sourceHandle}` : "unknown"} ${queryPlan.sourceName ?? ""}

Research goals for web search:
${formatGoalsForPrompt(queryPlan, "web")}

General search requirements:
- Prefer official, regulatory, company, exchange, reputable news, docs, filings, GitHub, contracts, and primary sources.
- Follow the goals in priority order.
- Say when a platform, ecosystem, ticker, project, or product link is only inferred.
- Find contradictions and refutations when a contradiction goal exists.
- Return concise evidence with citations, and separate facts from market interpretation.`;
}

function buildXSearchPrompt(queryPlan: ResearchQueryPlan): string {
  return `Investigate this market narrative on X.

Claim: ${queryPlan.normalizedClaim}
Source author: ${queryPlan.sourceHandle ? `@${queryPlan.sourceHandle}` : "unknown"} ${queryPlan.sourceName ?? ""}
Research goals for X search:
${formatGoalsForPrompt(queryPlan, "x")}

Look for:
- origin accounts or posts
- credible accounts discussing it
- refutations
- recycled screenshots or links
- social crowding
- promotional or coordinated language
- author reputation: whether the source is a respected builder/operator/investor
- smart engagement: high-signal replies, likes, reposts, or follower overlap
- person/project identity on X and relevant social ecosystems
- whether platform, ecosystem, project, or product claims are directly stated or inferred

X social momentum is not proof of truth.`;
}

function goalsForLane(queryPlan: ResearchQueryPlan, lane: "web" | "x"): ResearchGoal[] {
  return queryPlan.goals
    .filter((goal) => goal.lanes.includes(lane))
    .map((goal) => goal);
}

function formatGoalsForPrompt(queryPlan: ResearchQueryPlan, lane: "web" | "x"): string {
  const goals = goalsForLane(queryPlan, lane);
  if (goals.length === 0) {
    return "- No goals assigned to this lane.";
  }

  return goals.map((goal) => [
    `- ${goal.id} (${goal.kind}, priority ${goal.priority}, wave ${goal.budget.wave})`,
    `  Question: ${goal.question}`,
    `  Decision use: ${goal.decisionUse}`,
    `  Evidence needed: ${goal.evidenceNeeds.join("; ")}`,
    `  Supported if: ${goal.resolutionCriteria.supportedIf}`,
    `  Contradicted if: ${goal.resolutionCriteria.contradictedIf}`,
    `  Queries:`,
    ...queriesForGoal(queryPlan, lane, goal.id).map((query) => `  - [${query.id}] ${query.query}`),
  ].join("\n")).join("\n");
}

function queriesForGoal(queryPlan: ResearchQueryPlan, lane: "web" | "x", goalId: string) {
  return queryPlan.queryBatches
    .flatMap((batch) => batch.queries.map((query) => ({ ...query, wave: batch.wave })))
    .filter((query) => query.lane === lane && query.goalIds.includes(goalId))
    .sort((left, right) => left.wave - right.wave || right.priority - left.priority);
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
