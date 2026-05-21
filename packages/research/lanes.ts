import type {
  ResearchSearchLanes,
  SearchLaneResult,
} from "./index.ts";
import {
  EvidenceLedgerSchema,
  type EvidenceLedger,
  type QueryJob,
  type ResearchGoal,
  type ResearchEvidence,
  type ResearchQueryPlan,
} from "../core/schemas/index.ts";
import { MissingConnectorConfigError } from "../core/connector-errors.ts";
import { Output, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createXai } from "@ai-sdk/xai";
import type { TraceRecorder } from "../core/trace.ts";
import { evidenceLedgerPrompt } from "../ai/prompts/index.ts";
import { DEFAULT_CHEAP_MODEL } from "../ai/client.ts";

type SearchSource = {
  title?: string;
  url?: string;
};

export class OpenAiWebSearchLane {
  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY,
    private readonly model = process.env.OPENAI_WEB_SEARCH_MODEL ?? "gpt-5.4-mini",
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
        ledger: emptyLedger(),
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

  async runQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("OpenAI/Web Search lane", "OPENAI_API_KEY");
    }

    const prompt = buildWebQueryJobPrompt(job, queryPlan);
    const finishTrace = this.trace?.start({
      name: "openai_web_query_job",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Executing one auditable web query job and classifying returned sources into evidence claims.",
      input: {
        queryJobId: job.id,
        queryId: job.querySpecId,
        goalIds: job.goalIds,
        query: job.query,
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
      const ledger = await classifyEvidenceLedger({
        provider: "openai_web_search",
        job,
        queryPlan,
        summary: result.text,
        sources: result.sources,
      });
      const output = {
        lane: "openai_search" as const,
        evidence: evidenceFromLedger("openai_search", ledger),
        warnings: [],
        ledger,
      };
      finishTrace?.({
        output: {
          queryJobId: job.id,
          evidenceClaimCount: ledger.evidenceClaims.length,
          resultCount: ledger.searchResults.length,
          ledger,
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
        ledger: emptyLedger(),
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

  async runQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Grok X Search lane", "XAI_API_KEY");
    }

    const xai = createXai({ apiKey: this.apiKey });
    const prompt = buildXQueryJobPrompt(job, queryPlan);
    const finishTrace = this.trace?.start({
      name: "grok_x_query_job",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Executing one auditable X query job with image/video understanding and classifying posts into evidence claims.",
      input: {
        queryJobId: job.id,
        queryId: job.querySpecId,
        goalIds: job.goalIds,
        query: job.query,
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
      const ledger = await classifyEvidenceLedger({
        provider: "grok_x_search",
        job,
        queryPlan,
        summary: result.text,
        toolResults: result.toolResults,
      });
      const output = {
        lane: "x_search" as const,
        evidence: evidenceFromLedger("x_search", ledger),
        warnings: [],
        ledger,
      };
      finishTrace?.({
        output: {
          queryJobId: job.id,
          evidenceClaimCount: ledger.evidenceClaims.length,
          resultCount: ledger.searchResults.length,
          ledger,
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

  runOpenAiQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.openAiLane.runQueryJob(job, queryPlan);
  }

  runGrokXQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.grokLane.runQueryJob(job, queryPlan);
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

function buildWebQueryJobPrompt(job: QueryJob, queryPlan: ResearchQueryPlan): string {
  return `You are Cassie's web research lane.

Execute exactly this auditable query job.

Query: ${job.query}
Query kind: ${job.queryKind}
Expected evidence: ${job.expectedEvidence}
Rationale: ${job.rationale}

Claim: ${queryPlan.normalizedClaim}
Assets: ${queryPlan.assets.join(", ")}
Topics: ${queryPlan.topics.join(", ")}

Goals this query must serve:
${formatGoalsByIds(queryPlan, job.goalIds)}

Prefer primary, official, company, regulatory, reputable news, docs, filings, GitHub, contracts, and direct sources.
Return concise findings with citations. Do not synthesize a final trade view.`;
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

function buildXQueryJobPrompt(job: QueryJob, queryPlan: ResearchQueryPlan): string {
  return `You are Cassie's X research lane.

Execute exactly this auditable X query job.

Query: ${job.query}
Query kind: ${job.queryKind}
Expected evidence: ${job.expectedEvidence}
Rationale: ${job.rationale}

Claim: ${queryPlan.normalizedClaim}
Source author: ${queryPlan.sourceHandle ? `@${queryPlan.sourceHandle}` : "unknown"} ${queryPlan.sourceName ?? ""}

Goals this query must serve:
${formatGoalsByIds(queryPlan, job.goalIds)}

Look for origin posts, author/source reputation, smart engagement, direct refutations, recycled claims, coordinated language, image/video evidence, and whether claims are stated or inferred.
X social momentum is not proof of factual truth. Do not synthesize a final trade view.`;
}

function formatGoalsByIds(queryPlan: ResearchQueryPlan, goalIds: string[]): string {
  const ids = new Set(goalIds);
  const goals = queryPlan.goals.filter((goal) => ids.has(goal.id));
  if (goals.length === 0) {
    return "- No matching goals.";
  }

  return goals.map((goal) => [
    `- ${goal.id} (${goal.kind}, priority ${goal.priority}, wave ${goal.budget.wave})`,
    `  Question: ${goal.question}`,
    `  Evidence needed: ${goal.evidenceNeeds.join("; ")}`,
    `  Supported if: ${goal.resolutionCriteria.supportedIf}`,
    `  Contradicted if: ${goal.resolutionCriteria.contradictedIf}`,
  ].join("\n")).join("\n");
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

async function classifyEvidenceLedger(input: {
  provider: string;
  job: QueryJob;
  queryPlan: ResearchQueryPlan;
  summary: string;
  sources?: SearchSource[];
  toolResults?: unknown[];
}): Promise<EvidenceLedger> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new MissingConnectorConfigError("Evidence ledger classifier", "OPENROUTER_API_KEY");
  }

  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  const model = process.env.CASSIE_CHEAP_MODEL ?? process.env.OPENROUTER_CHEAP_MODEL ?? DEFAULT_CHEAP_MODEL;
  const result = await generateText({
    model: openrouter(model),
    output: Output.object({
      schema: EvidenceLedgerSchema,
      name: "cassie_evidence_ledger",
    }),
    prompt: evidenceLedgerPrompt({
      queryJob: input.job,
      normalizedClaim: input.queryPlan.normalizedClaim,
      goals: input.queryPlan.goals.filter((goal) => input.job.goalIds.includes(goal.id)),
      searchOutput: {
        summary: input.summary,
        sources: input.sources ?? [],
        toolResults: input.toolResults ?? [],
      },
      retrievedAt: new Date().toISOString(),
    }),
  });

  return result.output;
}

function evidenceFromLedger(sourceLane: "openai_search" | "x_search", ledger: EvidenceLedger): ResearchEvidence[] {
  if (ledger.evidenceClaims.length === 0) {
    return ledger.searchResults.map((result) => ({
      sourceLane,
      sourceType: sourceTypeForResearchEvidence(result.sourceType),
      title: result.title,
      url: result.url,
      author: result.author,
      publishedAt: result.publishedAt,
      summary: result.snippet ?? result.rawText ?? "",
      stance: "unclear" as const,
      reliability: reliabilityForResearchEvidence("unknown"),
      relevance: 0.5,
      notes: [`queryId: ${result.queryId}`, `queryJobId: ${result.queryJobId}`],
    }));
  }

  return ledger.evidenceClaims.map((claim) => {
    const result = ledger.searchResults.find((item) => item.id === claim.resultId);
    const strongestLink = ledger.goalEvidenceLinks
      .filter((link) => link.evidenceClaimId === claim.id)
      .sort((left, right) => right.strength - left.strength)[0];

    return {
      sourceLane,
      sourceType: sourceTypeForResearchEvidence(claim.sourceType),
      title: result?.title ?? null,
      url: result?.url ?? null,
      author: result?.author ?? null,
      publishedAt: result?.publishedAt ?? null,
      summary: claim.claimText,
      stance: stanceForResearchEvidence(strongestLink?.stance),
      reliability: reliabilityForResearchEvidence(claim.reliability),
      relevance: strongestLink?.relevance ?? claim.extractionConfidence,
      notes: [
        `queryId: ${claim.queryId}`,
        `queryJobId: ${claim.queryJobId}`,
        `evidenceClaimId: ${claim.id}`,
      ],
    };
  });
}

function emptyLedger(): EvidenceLedger {
  return {
    searchResults: [],
    evidenceClaims: [],
    goalEvidenceLinks: [],
  };
}

function sourceTypeForResearchEvidence(sourceType: EvidenceLedger["searchResults"][number]["sourceType"]) {
  switch (sourceType) {
    case "official":
    case "regulatory":
    case "company":
    case "exchange":
    case "news":
    case "social":
    case "blog":
    case "unknown":
      return sourceType;
    case "filing":
    case "court_doc":
      return "regulatory" as const;
    case "specialist_media":
      return "news" as const;
    case "docs":
    case "github":
      return "blog" as const;
    case "market_data":
    case "onchain_data":
    case "prediction_market":
    case "security_researcher":
    case "aggregator":
      return "unknown" as const;
  }
}

function stanceForResearchEvidence(stance: EvidenceLedger["goalEvidenceLinks"][number]["stance"] | undefined) {
  if (stance === "supports") return "supports" as const;
  if (stance === "contradicts") return "refutes" as const;
  if (stance === "qualifies") return "mixed" as const;
  return "unclear" as const;
}

function reliabilityForResearchEvidence(reliability: EvidenceLedger["evidenceClaims"][number]["reliability"]) {
  if (reliability === "unknown") return "medium" as const;
  return reliability;
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
