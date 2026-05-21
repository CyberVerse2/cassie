import type { StructuredAiClient } from "../ai.ts";
import {
  GoalResolutionSchema,
  ResearchQueryPlanSchema,
  ResearchReportSchema,
  type ResearchEvidence,
  type GoalResolution,
  type ResearchGoal,
  type ResearchQueryPlan,
  type ResearchReport,
  type SignalInterpretation,
  type SourcePost,
  type Thesis,
} from "../schemas.ts";
import { goalResolutionPrompt, researchQueryPlanPrompt, researchSynthesisPrompt } from "../prompts.ts";

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
  const waveResults = await executeResearchWaves({
    ai: input.ai,
    queryPlan,
    lanes: input.lanes,
  });
  const goalResolutions = waveResults.flatMap((wave) => wave.goalResolutions);

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
        waves: waveResults.map((wave) => ({
          wave: wave.wave,
          openAiResult: settledPayload(wave.openAiResult),
          xResult: settledPayload(wave.xResult),
        })),
      },
      goalResolutions,
    }),
  });
}

async function executeResearchWaves(input: {
  ai: StructuredAiClient;
  queryPlan: ResearchQueryPlan;
  lanes: ResearchSearchLanes;
}): Promise<Array<{
  wave: number;
  openAiResult: PromiseSettledResult<SearchLaneResult>;
  xResult: PromiseSettledResult<SearchLaneResult>;
  goalResolutions: GoalResolution[];
}>> {
  const waves = uniqueNumbers(input.queryPlan.queryBatches.map((batch) => batch.wave)).sort((left, right) => left - right);
  const results: Array<{
    wave: number;
    openAiResult: PromiseSettledResult<SearchLaneResult>;
    xResult: PromiseSettledResult<SearchLaneResult>;
    goalResolutions: GoalResolution[];
  }> = [];

  for (const wave of waves) {
    const wavePlan = planForWave(input.queryPlan, wave);
    const [openAiResult, xResult] = await Promise.allSettled([
      hasLaneQueries(wavePlan, "web")
        ? input.lanes.runOpenAiWebSearch(wavePlan)
        : Promise.resolve(skippedLane("openai_search", `No policy-approved web queries for wave ${wave}.`)),
      hasLaneQueries(wavePlan, "x")
        ? input.lanes.runGrokXSearch(wavePlan)
        : Promise.resolve(skippedLane("x_search", `No policy-approved X queries for wave ${wave}.`)),
    ]);
    const goalResolutions = await resolveResearchGoals({
      ai: input.ai,
      queryPlan: input.queryPlan,
      wave,
      openAiResult,
      xResult,
    });

    results.push({ wave, openAiResult, xResult, goalResolutions });
  }

  return results;
}

async function resolveResearchGoals(input: {
  ai: StructuredAiClient;
  queryPlan: ResearchQueryPlan;
  wave: number;
  openAiResult: PromiseSettledResult<SearchLaneResult>;
  xResult: PromiseSettledResult<SearchLaneResult>;
}): Promise<GoalResolution[]> {
  return input.ai.generateObject({
    schema: GoalResolutionSchema.array(),
    name: "cassie_goal_resolution",
    prompt: goalResolutionPrompt({
      wave: input.wave,
      goals: input.queryPlan.goals.filter((goal) => goal.budget.wave <= input.wave),
      synthesisContract: input.queryPlan.synthesisContract,
      laneResults: {
        openAiResult: settledPayload(input.openAiResult),
        xResult: settledPayload(input.xResult),
      },
    }),
  });
}

function planForWave(queryPlan: ResearchQueryPlan, wave: number): ResearchQueryPlan {
  return {
    ...queryPlan,
    goals: queryPlan.goals.filter((goal) => goal.budget.wave <= wave),
    queryBatches: queryPlan.queryBatches.filter((batch) => batch.wave === wave),
  };
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

  return ensureMandatoryResearchLanes({
    ...policyPlan,
    mode: needsMinimalWatchlist ? "minimal_watchlist" : policyPlan.mode,
    goals,
    queryBatches,
    synthesisContract: {
      requiredGoalIds,
      cannotConcludeIfUnresolved,
    },
  });
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

function ensureMandatoryResearchLanes(plan: ResearchQueryPlan): ResearchQueryPlan {
  let nextPlan = plan;
  if (!hasLaneQueries(nextPlan, "web")) {
    nextPlan = addMandatoryLane(nextPlan, "web");
  }
  if (!hasLaneQueries(nextPlan, "x")) {
    nextPlan = addMandatoryLane(nextPlan, "x");
  }
  return nextPlan;
}

function addMandatoryLane(plan: ResearchQueryPlan, lane: "web" | "x"): ResearchQueryPlan {
  const goalId = lane === "web" ? "g_mandatory_web_context" : "g_mandatory_x_context";
  if (plan.goals.some((goal) => goal.id === goalId)) {
    return plan;
  }

  const goal: ResearchGoal = {
    id: goalId,
    kind: lane === "web" ? "entity_resolution" : "source_provenance",
    question: lane === "web"
      ? "What does the public web say about the source signal, entities, and primary context?"
      : "What does X say about the source signal, origin, author context, and social-market reaction?",
    decisionUse: lane === "web" ? "route_to_deeper_research" : "decide_watchlist_priority",
    priority: 0.8,
    mustResolve: true,
    lanes: [lane],
    evidenceNeeds: [
      lane === "web"
        ? "At least one public web check for entity context, primary sources, or credible secondary context."
        : "At least one X check for origin, author context, social reaction, or refutation.",
    ],
    disconfirmingQuestions: [
      lane === "web"
        ? "Do public sources fail to support or identify the claimed event or entity?"
        : "Does X show the claim is recycled, refuted, promotional, or low-signal?",
    ],
    resolutionCriteria: {
      supportedIf: lane === "web"
        ? "Public web context identifies the entity, event, or credible source context."
        : "X context identifies the origin, author credibility, social reaction, or refutation status.",
      contradictedIf: lane === "web"
        ? "Public web context contradicts or cannot identify the signal."
        : "X context contradicts the signal or shows low-quality provenance.",
      unresolvedIf: `The mandatory ${lane === "web" ? "web" : "X"} surface cannot produce useful context.`,
    },
    budget: { maxQueries: 1, maxResults: 10, wave: 0 },
    stopWhen: [],
  };
  const query = {
    id: lane === "web" ? "q_mandatory_web_context" : "q_mandatory_x_context",
    goalIds: [goalId],
    lane,
    queryKind: lane === "web" ? "broad_context" as const : "social_provenance" as const,
    query: lane === "web"
      ? `${plan.normalizedClaim} ${plan.assets.join(" ")} ${plan.topics.join(" ")} primary source context`.trim()
      : `${plan.sourceHandle ? `from:${plan.sourceHandle} ` : ""}${plan.normalizedClaim} origin reaction refuted`.trim(),
    priority: 0.8,
    maxResults: 10,
    expectedEvidence: lane === "web"
      ? "Public web grounding for the signal."
      : "X provenance and social-market context for the signal.",
    rationale: `Cassie requires a mandatory ${lane === "web" ? "web" : "X"} surface check for every research run.`,
  };

  return {
    ...plan,
    goals: [...plan.goals, goal].sort(compareGoals),
    queryBatches: upsertWaveZeroQuery(plan.queryBatches, query),
    synthesisContract: {
      requiredGoalIds: uniqueIds([...plan.synthesisContract.requiredGoalIds, goalId]),
      cannotConcludeIfUnresolved: uniqueIds([...plan.synthesisContract.cannotConcludeIfUnresolved, goalId]),
    },
  };
}

function upsertWaveZeroQuery(
  batches: ResearchQueryPlan["queryBatches"],
  query: ResearchQueryPlan["queryBatches"][number]["queries"][number],
): ResearchQueryPlan["queryBatches"] {
  const waveZero = batches.find((batch) => batch.wave === 0);
  if (!waveZero) {
    return [
      {
        wave: 0,
        name: "Mandatory surface check",
        purpose: "Run mandatory web/X context checks before synthesis.",
        queries: [query],
      },
      ...batches,
    ];
  }

  return batches.map((batch) =>
    batch.wave === 0
      ? { ...batch, queries: [...batch.queries, query].sort(compareQueries) }
      : batch,
  );
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

function uniqueNumbers(values: number[]) {
  return [...new Set(values)];
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
