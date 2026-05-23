import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type {
  EvidenceClaim,
  ExecutionJob,
  GoalEvidenceLink,
  GoalResolution,
  QueryJob,
  SearchResult,
  TradeTicket,
  UserSettings,
} from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "user_1",
  walletAddress: "0x0000000000000000000000000000000000000000",
  allowedVenues: ["hyperliquid"],
  defaultTradeSizeUsd: 50,
  maxTradeSizeUsd: 100,
  maxDailyLossUsd: 100,
  minConfidence: 0.75,
  maxSpreadBps: 50,
  maxSlippageBps: 100,
  maxPositionUsd: 1_000,
  autoTradeEnabled: false,
};

describe("InMemoryCassieStore", () => {
  it("stores user settings, mentions, control runs, and audit events", async () => {
    const store = new InMemoryCassieStore();

    await store.upsertUserSettings(settings);
    const mention = await store.addMention({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: null,
        authorHandle: "example",
        authorName: "Example",
        text: "SOL ETF is inevitable.",
        createdAt: null,
      },
    });
    const run = await store.createRun({
      userId: "user_1",
      userCommand: mention.userCommand,
      sourcePost: mention.sourcePost,
    });
    await store.updateRun({
      ...run,
      status: "succeeded",
      result: { responseType: "critique" },
      updatedAt: new Date().toISOString(),
    });

    const snapshot = await store.load();
    expect(snapshot.userSettings).toHaveLength(1);
    expect(snapshot.mentions).toHaveLength(1);
    expect(snapshot.controlRuns).toHaveLength(1);
    expect(snapshot.auditEvents.map((event) => event.eventType)).toContain("mention.received");
  });

  it("finds execution jobs and auto-approved tickets without loading callers into full snapshots", async () => {
    const store = new InMemoryCassieStore();
    const ticket: TradeTicket = {
      ticketId: "ticket_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "SOL may rally.",
      venue: "hyperliquid",
      instrument: "SOL",
      side: "long",
      sizeUsd: 50,
      orderType: "marketable_limit",
      riskDecision: {
        decision: "approve",
        adjustedSizeUsd: 50,
      },
      approvalState: "not_required",
      venueData: {},
    };
    const job: ExecutionJob = {
      jobId: "job_1",
      ticketId: "ticket_2",
      status: "queued",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      failureReason: null,
      executionResult: null,
    };

    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    expect(await store.getExecutionJob("job_1")).toEqual(job);
    expect((await store.listAutoApprovedTicketsWithoutExecutionJob("run_1")).map((entry) => entry.ticketId))
      .toEqual(["ticket_1"]);
  });

  it("persists the research evidence ledger as first-class records", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: null,
        authorHandle: "example",
        authorName: "Example",
        text: "Exa raised $250M.",
        createdAt: null,
      },
    });
    const researchRun = await store.createResearchRun({
      controlRunId: run.runId,
      angle: "critic",
      queryPlan: {
        version: "research-query-plan/v1",
        normalizedClaim: "Exa raised $250M.",
      },
    });
    const queryJob: QueryJob = {
      id: "qj_1",
      runId: researchRun.researchRunId,
      wave: 0,
      querySpecId: "q_verify",
      goalIds: ["g_verify"],
      lane: "web",
      provider: "gemini_google_search",
      query: "\"Exa\" \"$250M\" funding",
      queryKind: "entity_event",
      priority: 0.95,
      maxResults: 5,
      mustExecuteAtomically: true,
      expectedEvidence: "Funding confirmation.",
      rationale: "Verify the core funding claim.",
    };
    const searchResult: SearchResult = {
      id: "result_1",
      runId: researchRun.researchRunId,
      queryJobId: queryJob.id,
      queryId: queryJob.querySpecId,
      goalIds: ["g_verify"],
      wave: 0,
      lane: "web",
      provider: "gemini_google_search",
      title: "Exa raises $250M",
      url: "https://example.com/exa",
      canonicalUrl: "https://example.com/exa",
      author: null,
      sourceName: "Example",
      sourceType: "news",
      publishedAt: null,
      retrievedAt: "2026-05-21T00:00:00.000Z",
      rawText: null,
      snippet: "Exa raised $250M.",
      rank: 1,
      duplicateOf: null,
      metadata: [],
    };
    const evidenceClaim: EvidenceClaim = {
      id: "claim_1",
      resultId: searchResult.id,
      queryJobId: queryJob.id,
      queryId: queryJob.querySpecId,
      goalIds: ["g_verify"],
      wave: 0,
      claimText: "Exa raised $250M.",
      normalizedClaim: "Exa raised $250M.",
      entities: ["Exa"],
      assets: [],
      topics: ["funding"],
      eventTime: null,
      claimTimeRelation: "same_time",
      sourceType: "news",
      directness: "direct_secondary",
      reliability: "medium",
      extractionConfidence: 0.9,
      quote: null,
      quoteStartChar: null,
      quoteEndChar: null,
    };
    const goalEvidenceLink: GoalEvidenceLink = {
      id: "link_1",
      goalId: "g_verify",
      evidenceClaimId: evidenceClaim.id,
      stance: "supports",
      relevance: 0.95,
      strength: 0.8,
      reason: "The claim directly confirms the funding event.",
      satisfiesEvidenceNeeds: ["Funding confirmation"],
      redFlags: [],
    };
    const goalResolution: GoalResolution = {
      goalId: "g_verify",
      status: "resolved_supported",
      confidence: 0.86,
      supportingEvidenceIds: [evidenceClaim.id],
      contradictingEvidenceIds: [],
      contextualEvidenceIds: [],
      unresolvedQuestions: [],
      summary: "Funding claim supported.",
      synthesisImplication: "Cassie may discuss the funding event as confirmed.",
    };

    await store.addResearchQueryJobs(researchRun.researchRunId, [queryJob]);
    await store.updateResearchQueryJobStatus(queryJob.id, {
      status: "succeeded",
      completedAt: "2026-05-21T00:00:01.000Z",
    });
    await store.addResearchEvidenceLedger(researchRun.researchRunId, {
      searchResults: [searchResult],
      evidenceClaims: [evidenceClaim],
      goalEvidenceLinks: [goalEvidenceLink],
    });
    await store.addResearchGoalResolutions(researchRun.researchRunId, 0, [goalResolution]);
    await store.addResearchContinuationDecision({
      researchRunId: researchRun.researchRunId,
      wave: 0,
      decision: {
        action: "stop_watchlist",
        reason: "No clean public-market expression yet.",
        resolvedGoalIds: ["g_verify"],
        unresolvedBlockingGoalIds: [],
        contradictedGoalIds: [],
        allowedNextGoalIds: [],
        maxAdditionalQueries: 0,
        adaptiveQueryInstructions: [],
        blockedActions: ["create_trade_ticket"],
      },
    });
    await store.addModelCallUsage({
      controlRunId: run.runId,
      researchRunId: researchRun.researchRunId,
      runStepId: null,
      purpose: "evidence_classification",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptName: "cassie_signal",
      promptVersion: "2026-05-20",
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: null,
      cachedTokens: null,
      totalTokens: 30,
      estimatedCostUsd: null,
      latencyMs: 123,
      status: "succeeded",
      error: null,
    });
    await store.addTradeabilityDecision({
      controlRunId: run.runId,
      researchRunId: researchRun.researchRunId,
      decision: "watchlist_only",
      directTradability: "private_only",
      blockingGoalIds: [],
      requiredResolvedGoalIds: ["g_verify"],
      rationale: "Direct exposure is private.",
      allowedExpressions: [],
      blockedExpressions: [{ instrument: "GOOGL", reason: "Read-through is too indirect." }],
    });

    const snapshot = await store.load();
    expect(snapshot.researchRuns).toHaveLength(1);
    expect(snapshot.researchQueryJobs).toMatchObject([{ id: "qj_1", status: "succeeded" }]);
    expect(snapshot.researchSearchResults).toHaveLength(1);
    expect(snapshot.researchEvidenceClaims).toHaveLength(1);
    expect(snapshot.researchGoalEvidenceLinks).toHaveLength(1);
    expect(snapshot.researchGoalResolutions).toMatchObject([{ goalId: "g_verify", status: "resolved_supported" }]);
    expect(snapshot.researchContinuationDecisions).toMatchObject([{ wave: 0, action: "stop_watchlist" }]);
    expect(snapshot.modelCallUsage).toMatchObject([{ purpose: "evidence_classification", totalTokens: 30 }]);
    expect(snapshot.tradeabilityDecisions).toMatchObject([{ decision: "watchlist_only" }]);
  });
});
