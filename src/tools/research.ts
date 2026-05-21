import type { StructuredAiClient } from "../ai.ts";
import {
  ResearchQueryPlanSchema,
  ResearchReportSchema,
  type ResearchEvidence,
  type ResearchGoal,
  type ResearchQueryPlan,
  type ResearchReport,
  type SignalInterpretation,
  type SourcePost,
  type Thesis,
} from "../schemas.ts";
import { researchQueryPlanPrompt, researchSynthesisPrompt } from "../prompts.ts";

export type ResearchAngle = "balanced" | "critic" | "counter";

export interface SearchLaneResult {
  lane: "openai_search" | "x_search";
  evidence: ResearchEvidence[];
  warnings: string[];
}

export interface ResearchSearchLanes {
  runOpenAiWebSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult>;
  runGrokXSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult>;
}

export async function researchThesis(input: {
  ai: StructuredAiClient;
  lanes: ResearchSearchLanes;
  sourcePost: SourcePost;
  userCommand: string;
  signal: SignalInterpretation;
  thesis: Thesis;
  researchAngle: ResearchAngle;
}): Promise<ResearchReport> {
  const queryPlan = normalizeResearchQueryPlan(await generateResearchQueryPlan(input), input.signal);

  const [openAiResult, xResult] = await Promise.allSettled([
    hasLaneQueries(queryPlan, "web")
      ? input.lanes.runOpenAiWebSearch(queryPlan)
      : Promise.resolve(skippedLane("openai_search", "No policy-approved web goals or queries.")),
    hasLaneQueries(queryPlan, "x")
      ? input.lanes.runGrokXSearch(queryPlan)
      : Promise.resolve(skippedLane("x_search", "No policy-approved X goals or queries.")),
  ]);

  return input.ai.generateObject({
    schema: ResearchReportSchema,
    name: "cassie_research_report",
    prompt: researchSynthesisPrompt({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      extractedThesis: input.thesis,
      mode: "deep",
      researchAngle: input.researchAngle,
      queryPlan,
      laneResults: {
        openAiResult: settledPayload(openAiResult),
        xResult: settledPayload(xResult),
      },
    }),
  });
}

function hasLaneQueries(queryPlan: ResearchQueryPlan, lane: "web" | "x") {
  return queryPlan.queryBatches.some((batch) => batch.queries.some((query) => query.lane === lane));
}

function skippedLane(lane: SearchLaneResult["lane"], reason: string): SearchLaneResult {
  return {
    lane,
    evidence: [],
    warnings: [reason],
  };
}

const vagueAllowedGoalKinds = new Set<ResearchGoal["kind"]>([
  "source_provenance",
  "entity_resolution",
  "social_momentum",
]);

export function normalizeResearchQueryPlan(
  plan: ResearchQueryPlan,
  signal: SignalInterpretation,
): ResearchQueryPlan {
  const policyPlan = ensureDisconfirmationGoal(plan);
  const needsMinimalWatchlist =
    !signal.containsExplicitThesis &&
    (signal.directTradability === "none" || signal.directTradability === "unknown") &&
    (signal.leadQuality === "ignore" || signal.leadQuality === "watchlist" || signal.leadQuality === "soft_signal") &&
    policyPlan.scores.specificity < 0.35 &&
    policyPlan.scores.marketLinkage < 0.4 &&
    policyPlan.scores.sourceValue < 0.7;

  const goals = needsMinimalWatchlist
    ? policyPlan.goals
      .filter((goal) => vagueAllowedGoalKinds.has(goal.kind))
      .sort(compareGoals)
    : policyPlan.goals.sort(compareGoals);

  const allowedGoalIds = new Set(goals.map((goal) => goal.id));
  const queryCap = needsMinimalWatchlist ? 3 : Number.POSITIVE_INFINITY;
  let usedQueries = 0;
  const queryBatches = policyPlan.queryBatches
    .map((batch) => ({
      ...batch,
      queries: batch.queries
        .filter((query) => query.goalIds.some((goalId) => allowedGoalIds.has(goalId)))
        .sort(compareQueries)
        .filter(() => {
          if (usedQueries >= queryCap) {
            return false;
          }
          usedQueries += 1;
          return true;
        }),
    }))
    .filter((batch) => batch.queries.length > 0);

  const requiredGoalIds = uniqueIds([
    ...policyPlan.synthesisContract.requiredGoalIds,
    ...goals.filter((goal) => goal.mustResolve).map((goal) => goal.id),
  ]).filter((goalId) => allowedGoalIds.has(goalId));

  const cannotConcludeIfUnresolved = uniqueIds([
    ...policyPlan.synthesisContract.cannotConcludeIfUnresolved,
    ...goals.filter((goal) => goal.mustResolve).map((goal) => goal.id),
  ]).filter((goalId) => allowedGoalIds.has(goalId));

  return {
    ...policyPlan,
    mode: needsMinimalWatchlist ? "minimal_watchlist" : policyPlan.mode,
    goals,
    queryBatches,
    synthesisContract: {
      requiredGoalIds,
      cannotConcludeIfUnresolved,
    },
  };
}

export async function generateResearchQueryPlan(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
  signal: SignalInterpretation;
  thesis: Thesis;
  researchAngle: ResearchAngle;
}): Promise<ResearchQueryPlan> {
  return input.ai.generateObject({
    schema: ResearchQueryPlanSchema,
    name: "cassie_research_query_plan",
    prompt: researchQueryPlanPrompt({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      signal: input.signal,
      thesis: input.thesis,
      researchAngle: input.researchAngle,
    }),
  });
}

function ensureDisconfirmationGoal(plan: ResearchQueryPlan): ResearchQueryPlan {
  const needsDisconfirmation =
    (plan.signalType === "explicit_trade" || plan.mode === "deep_dive" || plan.mode === "crisis") &&
    !plan.goals.some((goal) => goal.kind === "disconfirmation");

  if (!needsDisconfirmation) {
    return plan;
  }

  const disconfirmationGoal: ResearchGoal = {
    id: "g_disconfirmation",
    kind: "disconfirmation",
    question: "What evidence would invalidate, weaken, or materially qualify the trade thesis?",
    decisionUse: "find_disconfirming_evidence",
    priority: 0.95,
    mustResolve: true,
    lanes: ["web", "x"],
    evidenceNeeds: [
      "Primary-source contradictions, credible refutations, market-pricing evidence, or evidence that the catalyst is stale or already priced.",
    ],
    disconfirmingQuestions: [
      "Is the claimed catalyst false, stale, already priced, or materially weaker than the source implies?",
      "Are there primary sources or market signals contradicting the thesis?",
    ],
    resolutionCriteria: {
      supportedIf: "Credible evidence materially weakens or invalidates the thesis.",
      contradictedIf: "No credible contradiction appears after the required searches.",
      unresolvedIf: "Search cannot establish whether the strongest objections are valid.",
    },
    budget: { maxQueries: 4, maxResults: 30, wave: 1 },
    stopWhen: ["A primary source or market evidence invalidates the thesis."],
  };

  const claim = plan.normalizedClaim;
  const assetText = plan.assets.length > 0 ? plan.assets.join(" OR ") : claim;

  return {
    ...plan,
    goals: [...plan.goals, disconfirmationGoal],
    queryBatches: [
      ...plan.queryBatches,
      {
        wave: 1,
        name: "Disconfirmation",
        purpose: "Search for evidence that would invalidate or weaken the trade thesis.",
        queries: [
          {
            id: "q_disconfirm_web",
            goalIds: [disconfirmationGoal.id],
            lane: "web",
            queryKind: "disconfirming",
            query: `"${claim}" (false OR refuted OR denied OR stale OR "priced in")`,
            priority: 0.95,
            maxResults: 10,
            expectedEvidence: "Credible web evidence that contradicts, weakens, or qualifies the thesis.",
            rationale: "Every actionable trade thesis needs a disconfirmation search before synthesis.",
          },
          {
            id: "q_disconfirm_x",
            goalIds: [disconfirmationGoal.id],
            lane: "x",
            queryKind: "disconfirming",
            query: `(${assetText}) (${claim}) (false OR refuted OR denied OR "priced in")`,
            priority: 0.9,
            maxResults: 20,
            expectedEvidence: "Social refutations, specialist pushback, or evidence that the narrative is recycled.",
            rationale: "X is useful for fast contradiction discovery, but it is not proof by itself.",
          },
        ],
      },
    ],
    synthesisContract: {
      requiredGoalIds: uniqueIds([...plan.synthesisContract.requiredGoalIds, disconfirmationGoal.id]),
      cannotConcludeIfUnresolved: uniqueIds([
        ...plan.synthesisContract.cannotConcludeIfUnresolved,
        disconfirmationGoal.id,
      ]),
    },
  };
}

function compareGoals(left: ResearchGoal, right: ResearchGoal) {
  return right.priority - left.priority || left.budget.wave - right.budget.wave || left.id.localeCompare(right.id);
}

function compareQueries(
  left: ResearchQueryPlan["queryBatches"][number]["queries"][number],
  right: ResearchQueryPlan["queryBatches"][number]["queries"][number],
) {
  return right.priority - left.priority || left.id.localeCompare(right.id);
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function settledPayload<T>(result: PromiseSettledResult<T>) {
  if (result.status === "fulfilled") {
    return { status: "fulfilled", value: result.value };
  }

  return {
    status: "rejected",
    reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
}
