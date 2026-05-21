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
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import type { TraceRecorder } from "../core/trace.ts";

const DEFAULT_WEB_SEARCH_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_SEARCH_MAX_OUTPUT_TOKENS = 2_048;

export class GeminiWebSearchLane {
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    private readonly model = process.env.CASSIE_WEB_SEARCH_MODEL ?? process.env.GEMINI_WEB_SEARCH_MODEL ?? DEFAULT_WEB_SEARCH_MODEL,
    private readonly trace?: TraceRecorder,
    private readonly maxResults = Number(process.env.CASSIE_WEB_SEARCH_MAX_RESULTS ?? 5),
  ) {}

  async runQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Gemini Web Search lane", "GEMINI_API_KEY");
    }

    const google = createGoogleGenerativeAI({
      apiKey: this.apiKey,
    });
    const prompt = buildWebQueryJobPrompt(job, queryPlan);
    const finishTrace = this.trace?.start({
      name: "gemini_web_query_job",
      kind: "connector",
      model: this.model,
      thinkingTrace: "Executing one auditable Gemini web query job with Google Search grounding and classifying returned sources into evidence claims.",
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
          output: Output.object({
            schema: EvidenceLedgerSchema,
            name: "cassie_web_evidence_ledger",
          }),
          tools: {
            google_search: google.tools.googleSearch({
              searchTypes: { webSearch: {} },
            }),
          },
          prompt,
          providerOptions: {
            google: {
              thinkingConfig: {
                thinkingLevel: "minimal",
              },
            },
          },
          maxOutputTokens: GEMINI_SEARCH_MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(connectorCallTimeoutMs()),
        })
      );
      const ledger = result.output;
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
      const result = await wrapConnectorStage("Grok X search generation", () =>
        generateText({
          model: xai.responses(this.model),
          output: Output.object({
            schema: EvidenceLedgerSchema,
            name: "cassie_x_evidence_ledger",
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
      const ledger = result.output;
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
Return an EvidenceLedger JSON object only:
- searchResults are the retrieved sources for this exact query job.
- evidenceClaims are atomic claims extracted from those sources.
- goalEvidenceLinks classify each evidence claim against the relevant goals.
- Preserve runId, queryJobId, queryId, goalIds, wave, lane, and provider exactly.
- Use provider "gemini_google_search".
- Use stable ids like result_${job.id}_1, claim_${job.id}_1, link_${job.id}_<goalId>_1.
- Set retrievedAt to the current timestamp if available, otherwise an ISO timestamp for this run.
- Set metadata to [] unless a specific string key/value matters.
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
Return an EvidenceLedger JSON object only:
- searchResults are the retrieved posts/results for this exact query job.
- evidenceClaims are atomic claims extracted from those posts/results.
- goalEvidenceLinks classify each evidence claim against the relevant goals.
- Preserve runId, queryJobId, queryId, goalIds, wave, lane, and provider exactly.
- Use provider "grok_x_search".
- Use stable ids like result_${job.id}_1, claim_${job.id}_1, link_${job.id}_<goalId>_1.
- Set retrievedAt to the current timestamp if available, otherwise an ISO timestamp for this run.
- Set metadata to [] unless a specific string key/value matters.
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
  const value = Number(process.env.CASSIE_CONNECTOR_CALL_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(value) && value > 0 ? value : 180_000;
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
