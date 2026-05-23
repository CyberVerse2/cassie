import type {
  QueryJob,
  ResearchQueryPlan,
} from "../core/schemas/index.ts";

export type SearchSource = {
  sourceType: "url" | "document";
  title?: string;
  url?: string;
};

export function buildWebQueryJobPrompt(job: QueryJob, queryPlan: ResearchQueryPlan): string {
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

export function buildXQueryJobPrompt(job: QueryJob, queryPlan: ResearchQueryPlan): string {
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

export function buildSearchStructuringPrompt(input: {
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

export function formatGoalsByIds(queryPlan: ResearchQueryPlan, goalIds: string[]): string {
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
