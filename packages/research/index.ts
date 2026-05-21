import type { StructuredAiClient } from "../ai/client.ts";
import type { CassieStore } from "../db/store.ts";
import {
  AdaptiveQueryRequestSchema,
  type AdaptiveQueryRequest,
  type EvidenceLedger,
  GoalResolutionSchema,
  type QueryJob,
  type ResearchContinuationDecision,
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
} from "../core/schemas/index.ts";
import {
  adaptiveQueryRequestPrompt,
  goalResolutionPrompt,
  researchQueryPlanPrompt,
  researchSynthesisPrompt,
} from "../ai/prompts/index.ts";

export type ResearchAngle = "balanced" | "critic" | "counter";

export interface SearchLaneResult {
  lane: "openai_search" | "x_search";
  evidence: ResearchEvidence[];
  warnings: string[];
  ledger?: EvidenceLedger;
}

export interface ResearchSearchLanes {
  runOpenAiQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult>;
  runGrokXQueryJob(job: QueryJob, queryPlan: ResearchQueryPlan): Promise<SearchLaneResult>;
}

export interface ResearchPersistence {
  store: CassieStore;
  controlRunId: string;
}

export async function researchThesis(input: {
  ai: StructuredAiClient;
  lanes: ResearchSearchLanes;
  sourcePost: SourcePost;
  userCommand: string;
  signal: SignalInterpretation;
  thesis: Thesis;
  researchAngle: ResearchAngle;
  persistence?: ResearchPersistence;
}): Promise<ResearchReport> {
  const queryPlan = normalizeResearchQueryPlan(await generateResearchQueryPlan(input), input.signal);
  const researchRun = input.persistence
    ? await input.persistence.store.createResearchRun({
      controlRunId: input.persistence.controlRunId,
      angle: input.researchAngle,
      queryPlan,
    })
    : null;
  const researchRunId = researchRun?.researchRunId ?? `research_${stableSlug(queryPlan.normalizedClaim)}`;

  try {
    const waveResults = await executeResearchWaves({
      ai: input.ai,
      queryPlan,
      lanes: input.lanes,
      researchRunId,
      persistence: input.persistence,
    });
    const goalResolutions = waveResults.flatMap((wave) => wave.goalResolutions);
    const evidenceLedger = mergeLedgers(waveResults.flatMap((wave) => wave.evidenceLedger));

    const report = await input.ai.generateObject({
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
            continuationDecision: wave.continuationDecision,
            adaptiveDecisions: wave.adaptiveDecisions,
          })),
        },
        evidenceLedger,
        goalResolutions,
      }),
    });

    if (researchRun) {
      await input.persistence?.store.updateResearchRun({
        researchRunId: researchRun.researchRunId,
        status: "succeeded",
        completedAt: new Date().toISOString(),
      });
    }

    return report;
  } catch (error) {
    if (researchRun) {
      await input.persistence?.store.updateResearchRun({
        researchRunId: researchRun.researchRunId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

async function executeResearchWaves(input: {
  ai: StructuredAiClient;
  queryPlan: ResearchQueryPlan;
  lanes: ResearchSearchLanes;
  researchRunId: string;
  persistence?: ResearchPersistence;
}): Promise<Array<{
  wave: number;
  openAiResult: PromiseSettledResult<SearchLaneResult>;
  xResult: PromiseSettledResult<SearchLaneResult>;
  evidenceLedger: EvidenceLedger;
  goalResolutions: GoalResolution[];
  continuationDecision: ResearchContinuationDecision;
  adaptiveDecisions: ResearchContinuationDecision[];
}>> {
  const waves = uniqueNumbers(input.queryPlan.queryBatches.map((batch) => batch.wave)).sort((left, right) => left - right);
  const results: Array<{
    wave: number;
    openAiResult: PromiseSettledResult<SearchLaneResult>;
    xResult: PromiseSettledResult<SearchLaneResult>;
    evidenceLedger: EvidenceLedger;
    goalResolutions: GoalResolution[];
    continuationDecision: ResearchContinuationDecision;
    adaptiveDecisions: ResearchContinuationDecision[];
  }> = [];

  for (const wave of waves) {
    const wavePlan = planForWave(input.queryPlan, wave);
    const queryJobs = compileQueryJobs(input.queryPlan, wave, input.researchRunId);
    await input.persistence?.store.addResearchQueryJobs(input.researchRunId, queryJobs);
    let [openAiResult, xResult] = await Promise.all([
      settle(runLaneForWave({
        lane: "web",
        lanes: input.lanes,
        queryPlan: input.queryPlan,
        wavePlan,
        queryJobs,
        persistence: input.persistence,
        researchRunId: input.researchRunId,
      })),
      settle(runLaneForWave({
        lane: "x",
        lanes: input.lanes,
        queryPlan: input.queryPlan,
        wavePlan,
        queryJobs,
        persistence: input.persistence,
        researchRunId: input.researchRunId,
      })),
    ]);
    let evidenceLedger = mergeLedgers([
      ledgerFromSettledResult(openAiResult),
      ledgerFromSettledResult(xResult),
    ]);
    await input.persistence?.store.addResearchEvidenceLedger(input.researchRunId, evidenceLedger);
    let goalResolutions = asGoalResolutionArray(await resolveResearchGoals({
      ai: input.ai,
      queryPlan: input.queryPlan,
      wave,
      openAiResult,
      xResult,
      evidenceLedger,
    }));
    await input.persistence?.store.addResearchGoalResolutions(input.researchRunId, wave, goalResolutions);
    let continuationDecision = decideContinuation({
      queryPlan: input.queryPlan,
      wave,
      goalResolutions,
    });
    await input.persistence?.store.addResearchContinuationDecision({
      researchRunId: input.researchRunId,
      wave,
      decision: continuationDecision,
    });
    const adaptiveDecisions: ResearchContinuationDecision[] = [];
    let adaptiveRound = 0;

    while (continuationDecision.action === "continue_with_adaptive_queries" && adaptiveRound < 2) {
      adaptiveRound += 1;
      adaptiveDecisions.push(continuationDecision);
      const adaptiveRequest = await generateAdaptiveQueryRequest({
        ai: input.ai,
        queryPlan: input.queryPlan,
        wave,
        adaptiveRound,
        goalResolutions,
        continuationDecision,
        evidenceLedger,
      });
      const adaptiveJobs = compileAdaptiveQueryJobs({
        queryPlan: input.queryPlan,
        wave,
        adaptiveRound,
        adaptiveRequest,
        researchRunId: input.researchRunId,
      });
      await input.persistence?.store.addResearchQueryJobs(input.researchRunId, adaptiveJobs);
      if (adaptiveJobs.length === 0) {
        continuationDecision = {
          ...continuationDecision,
          action: "continue_planned",
          reason: "No useful adaptive query was generated for the unresolved evidence gap.",
          maxAdditionalQueries: 0,
          adaptiveQueryInstructions: [],
        };
        break;
      }

      const [adaptiveOpenAiResult, adaptiveXResult] = await Promise.all([
        settle(runLaneForWave({
          lane: "web",
          lanes: input.lanes,
          queryPlan: input.queryPlan,
          wavePlan,
          queryJobs: adaptiveJobs,
          persistence: input.persistence,
          researchRunId: input.researchRunId,
        })),
        settle(runLaneForWave({
          lane: "x",
          lanes: input.lanes,
          queryPlan: input.queryPlan,
          wavePlan,
          queryJobs: adaptiveJobs,
          persistence: input.persistence,
          researchRunId: input.researchRunId,
        })),
      ]);
      openAiResult = mergeSettledLaneResults("openai_search", openAiResult, adaptiveOpenAiResult);
      xResult = mergeSettledLaneResults("x_search", xResult, adaptiveXResult);
      evidenceLedger = mergeLedgers([
        evidenceLedger,
        ledgerFromSettledResult(adaptiveOpenAiResult),
        ledgerFromSettledResult(adaptiveXResult),
      ]);
      await input.persistence?.store.addResearchEvidenceLedger(
        input.researchRunId,
        mergeLedgers([
          ledgerFromSettledResult(adaptiveOpenAiResult),
          ledgerFromSettledResult(adaptiveXResult),
        ]),
      );
      goalResolutions = asGoalResolutionArray(await resolveResearchGoals({
        ai: input.ai,
        queryPlan: input.queryPlan,
        wave,
        openAiResult,
        xResult,
        evidenceLedger,
      }));
      await input.persistence?.store.addResearchGoalResolutions(input.researchRunId, wave, goalResolutions);
      continuationDecision = decideContinuation({
        queryPlan: input.queryPlan,
        wave,
        goalResolutions,
      });
      await input.persistence?.store.addResearchContinuationDecision({
        researchRunId: input.researchRunId,
        wave,
        decision: continuationDecision,
      });
    }

    results.push({ wave, openAiResult, xResult, evidenceLedger, goalResolutions, continuationDecision, adaptiveDecisions });
    if (continuationDecision.action === "stop_no_trade" || continuationDecision.action === "stop_watchlist") {
      break;
    }
  }

  return results;
}

function asGoalResolutionArray(value: GoalResolution[]): GoalResolution[] {
  return Array.isArray(value) ? value : [];
}

async function resolveResearchGoals(input: {
  ai: StructuredAiClient;
  queryPlan: ResearchQueryPlan;
  wave: number;
  openAiResult: PromiseSettledResult<SearchLaneResult>;
  xResult: PromiseSettledResult<SearchLaneResult>;
  evidenceLedger: EvidenceLedger;
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
      evidenceLedger: input.evidenceLedger,
    }),
  });
}

async function generateAdaptiveQueryRequest(input: {
  ai: StructuredAiClient;
  queryPlan: ResearchQueryPlan;
  wave: number;
  adaptiveRound: number;
  goalResolutions: GoalResolution[];
  continuationDecision: ResearchContinuationDecision;
  evidenceLedger: EvidenceLedger;
}): Promise<AdaptiveQueryRequest> {
  return input.ai.generateObject({
    schema: AdaptiveQueryRequestSchema,
    name: "cassie_adaptive_query_request",
    prompt: adaptiveQueryRequestPrompt({
      wave: input.wave,
      adaptiveRound: input.adaptiveRound,
      maxAdaptiveRounds: 2,
      maxQueries: input.continuationDecision.maxAdditionalQueries,
      queryPlan: input.queryPlan,
      goalResolutions: input.goalResolutions,
      continuationDecision: input.continuationDecision,
      evidenceLedger: input.evidenceLedger,
    }),
  });
}

function compileAdaptiveQueryJobs(input: {
  queryPlan: ResearchQueryPlan;
  wave: number;
  adaptiveRound: number;
  adaptiveRequest: AdaptiveQueryRequest;
  researchRunId: string;
}): QueryJob[] {
  return input.adaptiveRequest.requests.flatMap((request) =>
    request.proposedQueries.map((query, index): QueryJob => {
      const querySpecId = `q_adaptive_${stableSlug(request.unresolvedGoalId)}_${input.adaptiveRound}_${index + 1}`;
      return {
        id: `job_w${input.wave}_${querySpecId}`,
        runId: input.researchRunId,
        wave: input.wave,
        querySpecId,
        goalIds: [request.unresolvedGoalId],
        lane: query.lane,
        provider: query.lane === "web" ? "openai_web_search" : "grok_x_search",
        query: query.query,
        queryKind: query.queryKind,
        priority: query.priority,
        maxResults: query.maxResults,
        mustExecuteAtomically: true,
        expectedEvidence: query.expectedEvidence,
        rationale: `${query.rationale} Evidence gap: ${request.evidenceGap}`,
      };
    })
  ).slice(0, 3);
}

async function runLaneForWave(input: {
  lane: "web" | "x";
  lanes: ResearchSearchLanes;
  queryPlan: ResearchQueryPlan;
  wavePlan: ResearchQueryPlan;
  queryJobs: QueryJob[];
  persistence?: ResearchPersistence;
  researchRunId: string;
}): Promise<SearchLaneResult> {
  const laneJobs = input.queryJobs.filter((job) => job.lane === input.lane);
  const results: SearchLaneResult[] = [];

  if (laneJobs.length > 0) {
    const runJob = input.lane === "web" ? input.lanes.runOpenAiQueryJob : input.lanes.runGrokXQueryJob;
    const jobResults = await Promise.all(laneJobs.map(async (job) => {
      await input.persistence?.store.updateResearchQueryJobStatus(job.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      try {
        const result = await runJob.call(input.lanes, job, input.queryPlan);
        await input.persistence?.store.updateResearchQueryJobStatus(job.id, {
          status: "succeeded",
          completedAt: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        await input.persistence?.store.updateResearchQueryJobStatus(job.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }));
    results.push(...jobResults);
  }

  if (results.length === 0) {
    return skippedLane(
      input.lane === "web" ? "openai_search" : "x_search",
      `No policy-approved ${input.lane === "web" ? "web" : "X"} queries for wave ${input.wavePlan.queryBatches[0]?.wave ?? "unknown"}.`,
    );
  }

  return mergeLaneResults(input.lane === "web" ? "openai_search" : "x_search", results);
}

function compileQueryJobs(queryPlan: ResearchQueryPlan, wave: number, researchRunId: string): QueryJob[] {
  const goalsById = new Map(queryPlan.goals.map((goal) => [goal.id, goal]));

  return queryPlan.queryBatches
    .filter((batch) => batch.wave === wave)
    .flatMap((batch) =>
      batch.queries.map((query): QueryJob => {
        const goals = query.goalIds
          .map((goalId) => goalsById.get(goalId))
          .filter((goal): goal is ResearchGoal => Boolean(goal));
        return {
          id: `job_w${batch.wave}_${query.id}`,
          runId: researchRunId,
          wave: batch.wave,
          querySpecId: query.id,
          goalIds: query.goalIds,
          lane: query.lane,
          provider: query.lane === "web" ? "openai_web_search" : "grok_x_search",
          query: query.query,
          queryKind: query.queryKind,
          priority: query.priority,
          maxResults: query.maxResults,
          mustExecuteAtomically: shouldExecuteAtomically(query, goals),
          expectedEvidence: query.expectedEvidence,
          rationale: query.rationale,
        };
      })
    );
}

function shouldExecuteAtomically(
  query: ResearchQueryPlan["queryBatches"][number]["queries"][number],
  goals: ResearchGoal[],
): boolean {
  return goals.some((goal) => goal.mustResolve || goal.kind === "disconfirmation") ||
    query.queryKind === "primary_source" ||
    query.queryKind === "regulatory_lookup" ||
    query.priority >= 0.75;
}

function decideContinuation(input: {
  queryPlan: ResearchQueryPlan;
  wave: number;
  goalResolutions: GoalResolution[];
}): ResearchContinuationDecision {
  const requiredGoalIds = new Set(input.queryPlan.synthesisContract.requiredGoalIds);
  const contradictedRequired = input.goalResolutions.filter((resolution) =>
    requiredGoalIds.has(resolution.goalId) && resolution.status === "resolved_contradicted"
  );

  if (contradictedRequired.length > 0) {
    return {
      action: "stop_no_trade",
      reason: "A required research goal was contradicted, so deeper waves would be misleading.",
      resolvedGoalIds: input.goalResolutions
        .filter((resolution) => resolution.status === "resolved_supported")
        .map((resolution) => resolution.goalId),
      unresolvedBlockingGoalIds: [],
      contradictedGoalIds: contradictedRequired.map((resolution) => resolution.goalId),
      allowedNextGoalIds: [],
      maxAdditionalQueries: 0,
      adaptiveQueryInstructions: [],
      blockedActions: ["trade_expression", "market_router", "ticket_creation"],
    };
  }

  const unresolvedBlockingGoalIds = input.goalResolutions
    .filter((resolution) =>
      requiredGoalIds.has(resolution.goalId) &&
      (resolution.status === "unresolved" || resolution.status === "partially_resolved")
    )
    .map((resolution) => resolution.goalId);

  if (unresolvedBlockingGoalIds.length > 0) {
    return {
      action: "continue_with_adaptive_queries",
      reason: "A required research goal is unresolved, so Cassie needs targeted follow-up queries before continuing.",
      resolvedGoalIds: input.goalResolutions
        .filter((resolution) => resolution.status === "resolved_supported")
        .map((resolution) => resolution.goalId),
      unresolvedBlockingGoalIds,
      contradictedGoalIds: [],
      allowedNextGoalIds: [],
      maxAdditionalQueries: 3,
      adaptiveQueryInstructions: input.goalResolutions
        .filter((resolution) => unresolvedBlockingGoalIds.includes(resolution.goalId))
        .flatMap((resolution) => resolution.unresolvedQuestions.length > 0 ? resolution.unresolvedQuestions : [resolution.summary]),
      blockedActions: ["trade_expression", "market_router", "ticket_creation"],
    };
  }

  return {
    action: "continue_planned",
    reason: "No required goal has been contradicted after this wave.",
    resolvedGoalIds: input.goalResolutions
      .filter((resolution) => resolution.status === "resolved_supported")
      .map((resolution) => resolution.goalId),
    unresolvedBlockingGoalIds,
    contradictedGoalIds: [],
    allowedNextGoalIds: input.queryPlan.goals
      .filter((goal) => goal.budget.wave > input.wave)
      .map((goal) => goal.id),
    maxAdditionalQueries: 0,
    adaptiveQueryInstructions: [],
    blockedActions: unresolvedBlockingGoalIds.length > 0 ? ["ticket_creation"] : [],
  };
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
    ledger: emptyLedger(),
  };
}

function mergeLaneResults(lane: SearchLaneResult["lane"], results: SearchLaneResult[]): SearchLaneResult {
  return {
    lane,
    evidence: results.flatMap((result) => result.evidence),
    warnings: results.flatMap((result) => result.warnings),
    ledger: mergeLedgers(results.map((result) => result.ledger)),
  };
}

function mergeSettledLaneResults(
  lane: SearchLaneResult["lane"],
  left: PromiseSettledResult<SearchLaneResult>,
  right: PromiseSettledResult<SearchLaneResult>,
): PromiseSettledResult<SearchLaneResult> {
  if (left.status === "fulfilled" && right.status === "fulfilled") {
    return { status: "fulfilled", value: mergeLaneResults(lane, [left.value, right.value]) };
  }
  if (left.status === "fulfilled") {
    return left;
  }
  if (right.status === "fulfilled") {
    return right;
  }
  return left;
}

function emptyLedger(): EvidenceLedger {
  return {
    searchResults: [],
    evidenceClaims: [],
    goalEvidenceLinks: [],
  };
}

function mergeLedgers(ledgers: Array<EvidenceLedger | undefined>): EvidenceLedger {
  return ledgers.reduce<EvidenceLedger>((merged, ledger) => {
    if (!ledger) {
      return merged;
    }
    return {
      searchResults: [...merged.searchResults, ...ledger.searchResults],
      evidenceClaims: [...merged.evidenceClaims, ...ledger.evidenceClaims],
      goalEvidenceLinks: [...merged.goalEvidenceLinks, ...ledger.goalEvidenceLinks],
    };
  }, emptyLedger());
}

function ledgerFromSettledResult(result: PromiseSettledResult<SearchLaneResult>): EvidenceLedger {
  return result.status === "fulfilled" ? result.value.ledger ?? emptyLedger() : emptyLedger();
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
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

function stableSlug(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return slug || "signal";
}
