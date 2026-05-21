import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ToolLoopAgent, hasToolCall, tool } from "ai";
import { z } from "zod";
import {
  DEFAULT_CHEAP_MODEL,
  DEFAULT_EXPENSIVE_MODEL,
} from "../client.ts";
import { openAiCostControlOptions } from "../openai-options.ts";

const WEB_SEARCH_MODEL = process.env.CASSIE_WEB_SEARCH_MODEL ??
  process.env.OPENROUTER_WEB_SEARCH_MODEL ??
  "google/gemini-3.1-flash-lite";

type ResearchToolName =
  | "create_query_jobs"
  | "run_web_query"
  | "run_x_query"
  | "classify_evidence"
  | "resolve_goal"
  | "decide_continuation"
  | "propose_adaptive_queries"
  | "done";

type StepLike = {
  toolCalls?: Array<{ toolName?: string }>;
  toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
};

type PrepareInput = {
  stepNumber: number;
  steps: StepLike[];
  messages: unknown[];
};

export function createResearchToolLoopAgent() {
  return new ToolLoopAgent({
    id: "cassie-research-tool-loop",
    model: openRouterModel(WEB_SEARCH_MODEL),
    instructions: researchToolLoopInstructions(),
    tools: researchTools(),
    toolChoice: "required",
    stopWhen: [hasToolCall("done")],
    prepareStep: prepareResearchToolLoopStep as never,
  });
}

export async function prepareResearchToolLoopStep(input: PrepareInput) {
  const activeTools = chooseActiveTools(input.steps);
  const model = modelForTools(activeTools);

  return {
    model,
    activeTools,
    toolChoice: toolChoiceForTools(activeTools),
    messages: compressResearchToolMessages(input.messages),
    providerOptions: openAiProviderOptionsForTools(activeTools),
  };
}

export function compressResearchToolMessages(messages: unknown[]) {
  return messages.map((message) => {
    if (!isRecord(message) || message.role !== "tool") {
      return message;
    }

    const serialized = JSON.stringify(message);
    if (serialized.length <= 1000) {
      return message;
    }

    return {
      ...message,
      content: [
        {
          type: "tool-result",
          toolCallId: "compressed",
          toolName: "compressed_research_tool_result",
          output: {
            type: "json",
            value: compressToolPayload(message),
          },
        },
      ],
    };
  });
}

export function extractDoneAnswer(result: unknown): string | null {
  const calls = isRecord(result) && Array.isArray(result.staticToolCalls) ? result.staticToolCalls : [];
  const done = calls.find((call) => isRecord(call) && call.toolName === "done");
  if (!isRecord(done)) {
    return null;
  }

  const input = isRecord(done.input) ? done.input : null;
  return typeof input?.answer === "string" ? input.answer : null;
}

function researchTools() {
  return {
    create_query_jobs: tool({
      description: "Compile the approved research plan into auditable query jobs.",
      inputSchema: z.object({
        reason: z.string(),
      }),
      execute: async (input) => ({ status: "planned", ...input }),
    }),
    run_web_query: tool({
      description: "Run one auditable OpenRouter web-search query job and return raw search result metadata.",
      inputSchema: z.object({
        queryJobId: z.string(),
        query: z.string(),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    run_x_query: tool({
      description: "Run one auditable X query job and return raw post/result metadata.",
      inputSchema: z.object({
        queryJobId: z.string(),
        query: z.string(),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    classify_evidence: tool({
      description: "Classify retrieved results into SearchResult, EvidenceClaim, and GoalEvidenceLink ledger items.",
      inputSchema: z.object({
        queryJobIds: z.array(z.string()),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    resolve_goal: tool({
      description: "Resolve research goals from the classified evidence ledger.",
      inputSchema: z.object({
        goalIds: z.array(z.string()),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    decide_continuation: tool({
      description: "Decide whether to stop, continue planned waves, or request adaptive queries.",
      inputSchema: z.object({
        reason: z.string(),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    propose_adaptive_queries: tool({
      description: "Propose bounded adaptive follow-up queries for unresolved high-impact evidence gaps.",
      inputSchema: z.object({
        unresolvedGoalIds: z.array(z.string()),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    done: tool({
      description: "Signal that the constrained research loop is complete.",
      inputSchema: z.object({
        answer: z.string(),
      }),
    }),
  };
}

function chooseActiveTools(steps: StepLike[]): ResearchToolName[] {
  const lastTool = lastToolName(steps);
  const lastDecision = lastContinuationAction(steps);

  if (!lastTool) {
    return ["create_query_jobs"];
  }
  if (lastDecision === "continue_with_adaptive_queries") {
    return ["propose_adaptive_queries"];
  }
  if (lastDecision && lastDecision !== "continue_planned") {
    return ["done"];
  }

  switch (lastTool) {
    case "create_query_jobs":
    case "propose_adaptive_queries":
      return ["run_web_query", "run_x_query"];
    case "run_web_query":
    case "run_x_query":
      return ["classify_evidence"];
    case "classify_evidence":
      return ["resolve_goal"];
    case "resolve_goal":
      return ["decide_continuation"];
    case "decide_continuation":
      return ["done"];
    default:
      return ["done"];
  }
}

function modelForTools(activeTools: ResearchToolName[]) {
  if (activeTools.some((name) => name === "run_web_query" || name === "run_x_query" || name === "create_query_jobs")) {
    return openRouterModel(WEB_SEARCH_MODEL);
  }
  if (activeTools.includes("classify_evidence")) {
    return openRouterModel(process.env.CASSIE_CHEAP_MODEL ?? process.env.OPENROUTER_CHEAP_MODEL ?? DEFAULT_CHEAP_MODEL);
  }
  return openai(
    process.env.CASSIE_IMPORTANT_MODEL ??
      process.env.CASSIE_EXPENSIVE_MODEL ??
      process.env.CASSIE_MODEL ??
      DEFAULT_EXPENSIVE_MODEL,
  );
}

function toolChoiceForTools(activeTools: ResearchToolName[]) {
  return activeTools.length === 1
    ? { type: "tool" as const, toolName: activeTools[0] }
    : "required" as const;
}

function openAiProviderOptionsForTools(activeTools: ResearchToolName[]) {
  if (
    activeTools.includes("classify_evidence") ||
    activeTools.some((name) => name === "run_web_query" || name === "run_x_query" || name === "create_query_jobs")
  ) {
    return undefined;
  }

  return openAiCostControlOptions({
    promptCacheKey: `cassie-research-tool-loop-${activeTools.join("-")}`,
  });
}

function openRouterModel(model: string) {
  const reasoning = model.includes("gemini-3.1-flash-lite") ? { effort: "minimal" } : undefined;
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    compatibility: "strict",
    extraBody: {
      provider: { allow_fallbacks: true, require_parameters: true },
      ...(reasoning ? { reasoning } : {}),
    },
  });
  return openrouter(model);
}

function lastToolName(steps: StepLike[]): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    const resultTool = step?.toolResults?.at(-1)?.toolName;
    if (resultTool) return resultTool;
    const callTool = step?.toolCalls?.at(-1)?.toolName;
    if (callTool) return callTool;
  }

  return null;
}

function lastContinuationAction(steps: StepLike[]): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const result = steps[index]?.toolResults?.find((candidate) => candidate.toolName === "decide_continuation");
    const payload = isRecord(result?.output) ? result.output : isRecord(result?.result) ? result.result : null;
    const action = typeof payload?.action === "string" ? payload.action : null;
    if (action) return action;
  }

  return null;
}

function compressToolPayload(message: Record<string, unknown>) {
  const originalChars = JSON.stringify(message).length;
  const toolResults = Array.isArray(message.content)
    ? message.content
      .filter(isRecord)
      .filter((part) => part.type === "tool-result")
      .map(compressToolResultPart)
    : [compressToolResultPart({ output: message })];

  return {
    compressed: true,
    kind: "research_tool_digest",
    originalChars,
    toolResults,
    totals: mergeDigestTotals(toolResults),
  };
}

function compressToolResultPart(part: Record<string, unknown>) {
  const output = isRecord(part.output) && "value" in part.output ? part.output.value : part.output;
  return {
    toolName: stringOrNull(part.toolName),
    toolCallId: stringOrNull(part.toolCallId),
    digest: compressPayload(output),
  };
}

function compressPayload(payload: unknown) {
  const searchResults = findArraysByKey(payload, "searchResults").flat().filter(isRecord);
  const evidenceClaims = findArraysByKey(payload, "evidenceClaims").flat().filter(isRecord);
  const goalEvidenceLinks = findArraysByKey(payload, "goalEvidenceLinks").flat().filter(isRecord);
  const goalResolutions = findArraysByKey(payload, "goalResolutions").flat().filter(isRecord);
  const adaptiveRequests = findArraysByKey(payload, "adaptiveQueryRequests").flat().filter(isRecord)
    .concat(findArraysByKey(payload, "requests").flat().filter(isRecord));
  const continuationDecisions = findArraysByKey(payload, "researchContinuationDecisions").flat().filter(isRecord)
    .concat(findArraysByKey(payload, "continuationDecisions").flat().filter(isRecord));
  const errors = findValuesByKey(payload, "error")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return {
    status: firstStringByKeys(payload, ["status", "action"]),
    ids: compactStrings([
      firstStringByKeys(payload, ["runId", "controlRunId"]),
      firstStringByKeys(payload, ["researchRunId"]),
      firstStringByKeys(payload, ["queryJobId", "queryId"]),
    ]),
    counts: {
      searchResults: searchResults.length,
      evidenceClaims: evidenceClaims.length,
      goalEvidenceLinks: goalEvidenceLinks.length,
      goalResolutions: goalResolutions.length,
      adaptiveRequests: adaptiveRequests.length,
      errors: errors.length,
    },
    sources: uniqueBy(searchResults.map(summarizeSearchResult), sourceKey).slice(0, 12),
    keyClaims: evidenceClaims.map((claim) => summarizeEvidenceClaim(claim, goalEvidenceLinks)).slice(0, 16),
    contradictions: goalEvidenceLinks
      .filter((link) => stringOrNull(link.stance) === "contradicts")
      .map(summarizeGoalEvidenceLink)
      .slice(0, 12),
    unresolvedGaps: goalResolutions
      .filter((resolution) => ["unresolved", "partially_resolved"].includes(stringOrNull(resolution.status) ?? ""))
      .map(summarizeGoalResolution)
      .slice(0, 12),
    continuation: continuationDecisions.map(summarizeContinuationDecision).slice(0, 4),
    adaptiveRequests: adaptiveRequests.map(summarizeAdaptiveRequest).slice(0, 6),
    errors: errors.map((error) => truncate(error, 220)).slice(0, 8),
    preservedRawRefs: searchResults.filter(shouldPreserveRawRef).map((result) => ({
      resultId: stringOrNull(result.id),
      reason: rawPreservationReason(result),
    })).slice(0, 8),
  };
}

function summarizeSearchResult(result: Record<string, unknown>) {
  return {
    resultId: stringOrNull(result.id),
    queryJobId: stringOrNull(result.queryJobId),
    queryId: stringOrNull(result.queryId),
    goalIds: stringArray(result.goalIds),
    provider: stringOrNull(result.provider),
    title: stringOrNull(result.title),
    url: stringOrNull(result.url),
    canonicalUrl: stringOrNull(result.canonicalUrl),
    sourceName: stringOrNull(result.sourceName),
    sourceType: stringOrNull(result.sourceType),
    reliabilityHint: reliabilityHint(result),
    rank: numberOrNull(result.rank),
    snippet: truncate(stringOrNull(result.snippet) ?? stringOrNull(result.rawText), 240),
  };
}

function summarizeEvidenceClaim(claim: Record<string, unknown>, links: Record<string, unknown>[]) {
  const claimId = stringOrNull(claim.id);
  const claimLinks = links.filter((link) => stringOrNull(link.evidenceClaimId) === claimId);
  return {
    claimId,
    resultId: stringOrNull(claim.resultId),
    queryJobId: stringOrNull(claim.queryJobId),
    queryId: stringOrNull(claim.queryId),
    goalIds: stringArray(claim.goalIds),
    claim: truncate(stringOrNull(claim.claimText), 280),
    sourceType: stringOrNull(claim.sourceType),
    directness: stringOrNull(claim.directness),
    reliability: stringOrNull(claim.reliability),
    extractionConfidence: numberOrNull(claim.extractionConfidence),
    links: claimLinks.map(summarizeGoalEvidenceLink).slice(0, 6),
  };
}

function summarizeGoalEvidenceLink(link: Record<string, unknown>) {
  return {
    linkId: stringOrNull(link.id),
    evidenceClaimId: stringOrNull(link.evidenceClaimId),
    goalId: stringOrNull(link.goalId),
    stance: stringOrNull(link.stance),
    strength: numberOrNull(link.strength),
    relevance: numberOrNull(link.relevance),
    rationale: truncate(stringOrNull(link.rationale), 220),
  };
}

function summarizeGoalResolution(resolution: Record<string, unknown>) {
  return {
    goalId: stringOrNull(resolution.goalId),
    status: stringOrNull(resolution.status),
    confidence: numberOrNull(resolution.confidence),
    summary: truncate(stringOrNull(resolution.summary), 260),
    missingEvidence: stringArray(resolution.missingEvidence).slice(0, 5),
    synthesisImplication: truncate(stringOrNull(resolution.synthesisImplication), 240),
  };
}

function summarizeContinuationDecision(decision: Record<string, unknown>) {
  return {
    action: stringOrNull(decision.action),
    reason: truncate(stringOrNull(decision.reason), 260),
    maxAdditionalQueries: numberOrNull(decision.maxAdditionalQueries),
  };
}

function summarizeAdaptiveRequest(request: Record<string, unknown>) {
  return {
    unresolvedGoalId: stringOrNull(request.unresolvedGoalId),
    evidenceGap: truncate(stringOrNull(request.evidenceGap), 240),
    decisionImpact: truncate(stringOrNull(request.decisionImpact), 220),
    queries: Array.isArray(request.queries)
      ? request.queries.filter(isRecord).map((query) => ({
        lane: stringOrNull(query.lane),
        query: truncate(stringOrNull(query.query), 180),
        queryKind: stringOrNull(query.queryKind),
        priority: numberOrNull(query.priority),
      })).slice(0, 5)
      : [],
  };
}

function mergeDigestTotals(results: Array<{ digest: unknown }>) {
  return results.reduce((totals, result) => {
    const counts = isRecord(result.digest) && isRecord(result.digest.counts) ? result.digest.counts : {};
    return {
      searchResults: totals.searchResults + numberOrZero(counts.searchResults),
      evidenceClaims: totals.evidenceClaims + numberOrZero(counts.evidenceClaims),
      goalEvidenceLinks: totals.goalEvidenceLinks + numberOrZero(counts.goalEvidenceLinks),
      goalResolutions: totals.goalResolutions + numberOrZero(counts.goalResolutions),
      adaptiveRequests: totals.adaptiveRequests + numberOrZero(counts.adaptiveRequests),
      errors: totals.errors + numberOrZero(counts.errors),
    };
  }, {
    searchResults: 0,
    evidenceClaims: 0,
    goalEvidenceLinks: 0,
    goalResolutions: 0,
    adaptiveRequests: 0,
    errors: 0,
  });
}

function findArraysByKey(value: unknown, targetKey: string): unknown[][] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findArraysByKey(item, targetKey));
  }
  if (!isRecord(value)) {
    return [];
  }
  const matches = Array.isArray(value[targetKey]) ? [value[targetKey] as unknown[]] : [];
  return matches.concat(Object.values(value).flatMap((item) => findArraysByKey(item, targetKey)));
}

function findValuesByKey(value: unknown, targetKey: string): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findValuesByKey(item, targetKey));
  }
  if (!isRecord(value)) {
    return [];
  }
  const matches = targetKey in value ? [value[targetKey]] : [];
  return matches.concat(Object.values(value).flatMap((item) => findValuesByKey(item, targetKey)));
}

function firstStringByKeys(value: unknown, keys: string[]): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringByKeys(item, keys);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const found = stringOrNull(value[key]);
    if (found) return found;
  }
  for (const item of Object.values(value)) {
    const found = firstStringByKeys(item, keys);
    if (found) return found;
  }
  return null;
}

function shouldPreserveRawRef(result: Record<string, unknown>) {
  const sourceType = stringOrNull(result.sourceType);
  return sourceType === "official" ||
    sourceType === "regulatory" ||
    sourceType === "filing" ||
    sourceType === "company" ||
    sourceType === "security_researcher";
}

function rawPreservationReason(result: Record<string, unknown>) {
  const sourceType = stringOrNull(result.sourceType);
  return sourceType ? `${sourceType} source may need exact wording` : "source may need exact wording";
}

function reliabilityHint(result: Record<string, unknown>) {
  const sourceType = stringOrNull(result.sourceType);
  if (sourceType === "official" || sourceType === "regulatory" || sourceType === "filing") return "high";
  if (sourceType === "social" || sourceType === "unknown") return "unknown";
  return null;
}

function sourceKey(source: ReturnType<typeof summarizeSearchResult>) {
  return source.canonicalUrl ?? source.url ?? source.resultId ?? JSON.stringify(source);
}

function uniqueBy<T>(items: T[], keyForItem: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyForItem(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compactStrings(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value));
}

function truncate(value: string | null, maxLength: number) {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function researchToolLoopInstructions() {
  return `You are Cassie's constrained research tool loop.

You must use tools at every step. Never answer directly during research.
Move through the phases: create query jobs, run web/X query jobs, classify evidence, resolve goals, decide continuation, optionally propose adaptive queries, then call done.
Use done only when the research ledger and continuation decision are ready for the host pipeline to synthesize.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
