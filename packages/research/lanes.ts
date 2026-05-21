import type {
  ResearchSearchLanes,
  SearchLaneResult,
} from "./index.ts";
import {
  EvidenceLedgerSchema,
  type EvidenceLedger,
  type QueryJob,
  type ResearchEvidence,
  type ResearchQueryPlan,
} from "../core/schemas/index.ts";
import { MissingConnectorConfigError } from "../core/connector-errors.ts";
import { Output, generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createXai } from "@ai-sdk/xai";
import type { TraceRecorder } from "../core/trace.ts";
import { evidenceLedgerPrompt } from "../ai/prompts/index.ts";
import { DEFAULT_CHEAP_MODEL } from "../ai/client.ts";
import { openRouterCacheablePrompt } from "../ai/openrouter-options.ts";

type SearchSource = {
  title?: string;
  url?: string;
};

const DEFAULT_WEB_SEARCH_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_WEB_SEARCH_ENGINE = "native";

export class OpenAiWebSearchLane {
  constructor(
    private readonly apiKey = process.env.OPENROUTER_API_KEY,
    private readonly model = process.env.CASSIE_WEB_SEARCH_MODEL ?? process.env.OPENROUTER_WEB_SEARCH_MODEL ?? DEFAULT_WEB_SEARCH_MODEL,
    private readonly trace?: TraceRecorder,
    private readonly maxResults = Number(process.env.CASSIE_WEB_SEARCH_MAX_RESULTS ?? 5),
    private readonly searchEngine = process.env.CASSIE_WEB_SEARCH_ENGINE ?? DEFAULT_WEB_SEARCH_ENGINE,
  ) {}

  async runQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("OpenRouter/Web Search lane", "OPENROUTER_API_KEY");
    }

    const openrouter = createOpenRouter({
      apiKey: this.apiKey,
      compatibility: "strict",
      extraBody: {
        provider: {
          allow_fallbacks: true,
          require_parameters: true,
        },
        plugins: [
          {
            id: "web",
            max_results: this.maxResults,
            engine: this.searchEngine,
          },
        ],
        reasoning: {
          effort: "minimal",
        },
      },
    });
    const prompt = buildWebQueryJobPrompt(job, queryPlan);
    const finishTrace = this.trace?.start({
      name: "openrouter_web_query_job",
      kind: "connector",
      model: this.model,
      thinkingTrace: `Executing one auditable OpenRouter web query job with ${this.searchEngine} search and classifying returned sources into evidence claims.`,
      input: {
        queryJobId: job.id,
        queryId: job.querySpecId,
        goalIds: job.goalIds,
        query: job.query,
      },
    });

    try {
      const result = await generateText({
        model: openrouter(this.model),
        messages: openRouterCacheablePrompt(prompt),
      });
      const ledger = await classifyEvidenceLedger({
        provider: "openrouter_web_search",
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
    private readonly model = process.env.GROK_X_SEARCH_MODEL ?? "grok-4.3",
    private readonly trace?: TraceRecorder,
  ) {}

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

  runOpenAiQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.openAiLane.runQueryJob(job, queryPlan);
  }

  runGrokXQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.grokLane.runQueryJob(job, queryPlan);
  }
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
Return concise findings with citations. Every source-backed finding should include a markdown link to the cited source.
Do not synthesize a final trade view.`;
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
  const prompt = evidenceLedgerPrompt({
    queryJob: input.job,
    normalizedClaim: input.queryPlan.normalizedClaim,
    goals: input.queryPlan.goals.filter((goal) => input.job.goalIds.includes(goal.id)),
    searchOutput: {
      summary: input.summary,
      sources: input.sources ?? [],
      toolResults: input.toolResults ?? [],
    },
    retrievedAt: new Date().toISOString(),
  });
  const result = await generateText({
    model: openrouter(model),
    output: Output.object({
      schema: EvidenceLedgerSchema,
      name: "cassie_evidence_ledger",
    }),
    messages: openRouterCacheablePrompt(prompt),
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
