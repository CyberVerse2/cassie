import type {
  ResearchSearchLanes,
  SearchLaneResult,
} from "./index.ts";
import {
  createDeepSeek,
  type DeepSeekLanguageModelOptions,
} from "@ai-sdk/deepseek";
import {
  type EvidenceLedger,
  type QueryJob,
  type ResearchEvidence,
  type ResearchQueryPlan,
  SearchSourceTypeSchema,
} from "../core/schemas/index.ts";
import { MissingConnectorConfigError } from "../core/connector-errors.ts";
import { Output, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { z } from "zod";
import type { TraceRecorder } from "../core/trace.ts";
import {
  cassieCheapModel,
  cassieWebSearchModel,
  deepSeekApiKey,
  googleApiKey,
  grokXSearchModel,
  numberEnv,
  requiredConnectorEnv,
  xAiApiKey,
} from "../core/env.ts";
import { configureAiSdkWarningLogging } from "../ai/sdk-warnings.ts";
import { DEFAULT_CHEAP_MODEL, DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS } from "../ai/client.ts";
import { googleThinkingOptions } from "../ai/google-options.ts";

configureAiSdkWarningLogging();

const DEFAULT_WEB_SEARCH_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_SEARCH_MAX_OUTPUT_TOKENS = 2_048;
const SEARCH_TEXT_MAX_OUTPUT_TOKENS = 1_024;
const MAX_SOURCES_PER_QUERY_JOB = 2;
const EvidenceDirectnessFromSearchSchema = z.preprocess((value) => {
  if (value == null) return "context";
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  switch (normalized) {
    case "direct":
    case "primary_source":
    case "official":
    case "official_source":
      return "primary";
    case "secondary":
    case "direct_secondary_source":
    case "directly_secondary":
      return "direct_secondary";
    case "indirect_secondary":
    case "background":
      return "indirect";
    case "rumour":
      return "rumor";
    default:
      return normalized;
  }
}, z.enum(["primary", "direct_secondary", "indirect", "rumor", "context"]));

export const SearchQueryOutputSchema = z.object({
  findings: z.array(z.object({
    claim: z.string(),
    sourceUrls: z.array(z.string()),
    relevance: z.number().min(0).max(1),
    stance: z.enum(["supports", "contradicts", "qualifies", "context", "irrelevant"]),
    sourceType: SearchSourceTypeSchema,
    reliability: z.enum(["high", "medium", "low", "unknown"]),
    directness: EvidenceDirectnessFromSearchSchema,
    quote: z.string().nullable(),
  })).max(4),
  sources: z.array(z.object({
    title: z.string().nullable(),
    url: z.string().nullable(),
    sourceName: z.string().nullable(),
    sourceType: SearchSourceTypeSchema,
    publishedAt: z.string().nullable(),
    snippet: z.string().nullable(),
  })).max(MAX_SOURCES_PER_QUERY_JOB),
  unresolved: z.array(z.string()).max(4),
});

type SearchQueryOutput = z.infer<typeof SearchQueryOutputSchema>;

type SearchSource = {
  sourceType: "url" | "document";
  title?: string;
  url?: string;
};

export class GeminiWebSearchLane {
  constructor(
    private readonly apiKey = googleApiKey(),
    private readonly model = cassieWebSearchModel(DEFAULT_WEB_SEARCH_MODEL),
    private readonly trace?: TraceRecorder,
    private readonly structuredModel = cassieCheapModel(DEFAULT_CHEAP_MODEL),
  ) {}

  async runQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Gemini Web Search lane", "GEMINI_API_KEY");
    }
    if (!deepSeekApiKey()) {
      throw new MissingConnectorConfigError("Search result structurer", "DEEPSEEK_API_KEY");
    }

    const google = createGoogleGenerativeAI({
      apiKey: this.apiKey,
    });
    const prompt = buildWebQueryJobPrompt(job, queryPlan);
    const finishTrace = this.trace?.start({
      name: "gemini_web_query_job",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Executing one auditable Gemini web query job with Google Search grounding, then structuring the compact result with DeepSeek.",
      input: {
        queryJobId: job.id,
        queryId: job.querySpecId,
        goalIds: job.goalIds,
        query: job.query,
      },
    });

    try {
      const result = await wrapConnectorStage("Gemini web search generation", () =>
        generateText({
          model: google(this.model),
          tools: {
            google_search: google.tools.googleSearch({
              searchTypes: { webSearch: {} },
            }),
          },
          system: "Return concise source-backed research notes in plain text. Do not return JSON.",
          prompt,
          providerOptions: googleThinkingOptions("minimal"),
          maxOutputTokens: SEARCH_TEXT_MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(connectorCallTimeoutMs()),
        })
      );
      const structured = await wrapConnectorStage("DeepSeek search result structuring", () =>
        structureSearchText({
          model: this.structuredModel,
          provider: "gemini_google_search",
          job,
          queryPlan,
          searchText: result.text,
          sources: result.sources,
        })
      );
      const ledger = ledgerFromSearchOutput({
        job,
        provider: "gemini_google_search",
        output: structured,
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
    private readonly apiKey = xAiApiKey(),
    private readonly model = grokXSearchModel(),
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
      thinkingTrace: "Executing one auditable X query job with image/video understanding and compact structured search output.",
      input: {
        queryJobId: job.id,
        queryId: job.querySpecId,
        goalIds: job.goalIds,
        query: job.query,
      },
    });

    try {
      const result = await wrapConnectorStage("Grok X search generation", () =>
        generateText({
          model: xai.responses(this.model),
          output: Output.object({
            schema: SearchQueryOutputSchema,
            name: "cassie_x_search_result",
          }),
          tools: {
            x_search: xai.tools.xSearch({
              enableImageUnderstanding: true,
              enableVideoUnderstanding: true,
            }),
          },
          toolChoice: "auto",
          prompt,
          abortSignal: AbortSignal.timeout(connectorCallTimeoutMs()),
        })
      );
      const ledger = ledgerFromSearchOutput({
        job,
        provider: "grok_x_search",
        output: result.output,
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
    private readonly openAiLane = new GeminiWebSearchLane(),
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
Return concise source-backed research notes in plain text.
Include only notes and source references for this exact query job.
Keep the notes compact and decision-useful; the downstream evidence classifier will convert them into structured sources, evidence claims, and goal links.
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
X social momentum is not proof of factual truth.
Return compact structured search output matching the provided schema:
- sources are the retrieved posts/results for this exact query job.
- findings are atomic source-backed claims extracted from those posts/results.
- Keep findings to the most decision-useful claims; max 4 findings and max 2 sources.
- Every finding sourceUrls entry must match one of the returned source urls.
- Every finding must include directness exactly as one of: primary, direct_secondary, indirect, rumor, context. If unsure, use context.
Do not synthesize a final trade view.`;
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

function connectorCallTimeoutMs() {
  return numberEnv("CASSIE_CONNECTOR_CALL_TIMEOUT_MS", 180_000, undefined, { min: 1 });
}

async function structureSearchText(input: {
  model: string;
  provider: string;
  job: QueryJob;
  queryPlan: ResearchQueryPlan;
  searchText: string;
  sources: SearchSource[];
}): Promise<SearchQueryOutput> {
  const deepseek = createDeepSeek({
    apiKey: requiredConnectorEnv("Search result structurer", "DEEPSEEK_API_KEY"),
  });
  const result = await generateText({
    model: deepseek.chat(input.model),
    output: Output.object({
      schema: SearchQueryOutputSchema,
      name: "cassie_search_result_structuring",
    }),
    prompt: buildSearchStructuringPrompt(input),
    providerOptions: {
      deepseek: {
        thinking: { type: "disabled" },
      } satisfies DeepSeekLanguageModelOptions,
    },
    maxOutputTokens: DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(connectorCallTimeoutMs()),
  });
  return result.output;
}

function buildSearchStructuringPrompt(input: {
  provider: string;
  job: QueryJob;
  queryPlan: ResearchQueryPlan;
  searchText: string;
  sources: SearchSource[];
}): string {
  return `You are Cassie's evidence classifier and search result structurer.

Fill the structured result from the raw search notes.
Do not add claims that are not present in the raw search notes or source list.
Every finding sourceUrls entry must match a source URL from the source list when URLs are available.
Use no more than 4 findings and 2 sources.
Use unresolved for important missing evidence or ambiguity.
Classify each atomic finding as an EvidenceClaim candidate:
- sourceType
- stance against the relevant goals
- directness: use exactly one of primary, direct_secondary, indirect, rumor, or context. If unsure, use context.
- reliability
- source-backed quote when available
- relevance to the evidence needs
An unfamiliar blog, outlet, or source is not automatically low quality. If the source is unfamiliar but not discredited, classify reliability as medium and keep evidence strength neutral at 0.5 unless the source content, citations, corroboration, or red flags justify a different score.
Do not synthesize a trade view. Do not infer goal support from the lane summary; only classify source-backed claims.

Query job:
${JSON.stringify({
    runId: input.job.runId,
    queryJobId: input.job.id,
    queryId: input.job.querySpecId,
    goalIds: input.job.goalIds,
    lane: input.job.lane,
    provider: input.provider,
    query: input.job.query,
    queryKind: input.job.queryKind,
    expectedEvidence: input.job.expectedEvidence,
    rationale: input.job.rationale,
  }, null, 2)}

Research claim:
${input.queryPlan.normalizedClaim}

Relevant goals:
${formatGoalsByIds(input.queryPlan, input.job.goalIds)}

Source list:
${JSON.stringify(input.sources.map(sourceForPrompt), null, 2)}

Raw search notes:
${input.searchText}`;
}

function sourceForPrompt(source: SearchSource) {
  if (source.sourceType === "url" && source.url) {
    return {
      title: source.title ?? null,
      url: source.url,
      sourceType: "unknown",
    };
  }
  return {
    title: source.title,
    url: null,
    sourceType: "unknown",
  };
}

function ledgerFromSearchOutput(input: {
  job: QueryJob;
  provider: string;
  output: SearchQueryOutput;
}): EvidenceLedger {
  const retrievedAt = new Date().toISOString();
  const sources = input.output.sources.slice(0, Math.min(input.job.maxResults, MAX_SOURCES_PER_QUERY_JOB));
  const searchResults = sources.map((source, index) => ({
    id: `result_${input.job.id}_${index + 1}`,
    runId: input.job.runId,
    queryJobId: input.job.id,
    queryId: input.job.querySpecId,
    goalIds: input.job.goalIds,
    wave: input.job.wave,
    lane: input.job.lane,
    provider: input.provider,
    title: source.title,
    url: source.url,
    canonicalUrl: source.url,
    author: null,
    sourceName: source.sourceName,
    sourceType: source.sourceType,
    publishedAt: source.publishedAt,
    retrievedAt,
    rawText: null,
    snippet: source.snippet,
    rank: index + 1,
    duplicateOf: null,
    metadata: [],
  }));
  const evidenceClaims = input.output.findings.map((finding, index) => {
    const result = searchResults.find((candidate) => candidate.url && finding.sourceUrls.includes(candidate.url));
    return {
      id: `claim_${input.job.id}_${index + 1}`,
      resultId: result?.id ?? `result_${input.job.id}_missing`,
      queryJobId: input.job.id,
      queryId: input.job.querySpecId,
      goalIds: input.job.goalIds,
      wave: input.job.wave,
      claimText: finding.claim,
      normalizedClaim: null,
      entities: [],
      assets: [],
      topics: [],
      eventTime: null,
      claimTimeRelation: "unclear" as const,
      sourceType: finding.sourceType,
      directness: finding.directness,
      reliability: finding.reliability,
      extractionConfidence: finding.relevance,
      quote: finding.quote,
      quoteStartChar: null,
      quoteEndChar: null,
    };
  }).filter((claim) => searchResults.some((result) => result.id === claim.resultId));
  const goalEvidenceLinks = evidenceClaims.flatMap((claim, claimIndex) =>
    input.job.goalIds.map((goalId) => {
      const finding = input.output.findings[claimIndex];
      return {
        id: `link_${input.job.id}_${goalId}_${claimIndex + 1}`,
        goalId,
        evidenceClaimId: claim.id,
        stance: finding?.stance ?? "context" as const,
        relevance: finding?.relevance ?? claim.extractionConfidence,
        strength: finding ? evidenceStrengthForFinding(finding) : claim.extractionConfidence,
        reason: `Structured finding from ${input.provider} for query ${input.job.querySpecId}.`,
        satisfiesEvidenceNeeds: finding?.stance === "supports" ? [input.job.expectedEvidence] : [],
        redFlags: [],
      };
    })
  );

  return {
    searchResults,
    evidenceClaims,
    goalEvidenceLinks,
  };
}

function evidenceStrengthForFinding(finding: SearchQueryOutput["findings"][number]): number {
  if (finding.reliability === "medium" || finding.reliability === "unknown") {
    return 0.5;
  }
  return finding.relevance;
}

async function wrapConnectorStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`${stage} failed: ${formatResearchConnectorError(error)}`, { cause: error });
  }
}

export function formatResearchConnectorError(error: unknown): string {
  return detailedErrorMessage(error, new Set());
}

function detailedErrorMessage(error: unknown, seen: Set<unknown>): string {
  if (!error || seen.has(error)) {
    return String(error);
  }
  seen.add(error);

  if (typeof error !== "object") {
    return String(error);
  }

  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.message === "string") {
    parts.push(record.message);
  }
  if (typeof record.statusCode === "number") {
    parts.push(`status=${record.statusCode}`);
  }
  const data = compactJson(record.data);
  if (data) {
    parts.push(`data=${data}`);
  }
  const responseBody = compactText(record.responseBody);
  if (responseBody) {
    parts.push(`response=${responseBody}`);
  }
  const cause = record.cause;
  if (cause) {
    parts.push(`cause=${detailedErrorMessage(cause, seen)}`);
  }

  if (parts.length > 0) {
    return parts.join(" | ");
  }
  return error instanceof Error ? error.message : String(error);
}

function compactJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return compactText(JSON.stringify(value));
  } catch {
    return compactText(String(value));
  }
}

function compactText(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return null;
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
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
