import { describe, expect, it } from "vitest";
import type { CassieStoreSnapshot } from "../packages/core/db/store.ts";
import { formatRunTimeline } from "../src/timeline.ts";

const snapshot: CassieStoreSnapshot = {
  mentions: [],
  researchReports: [],
  tradeTickets: [],
  executionJobs: [],
  auditEvents: [],
  userSettings: [],
  controlRuns: [
    {
      runId: "run_1",
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: "https://x.com/example/status/post_1",
        authorHandle: "example",
        authorName: "Example",
        text: "Exa raised $250M.",
        createdAt: "2026-05-21T00:00:00.000Z",
      },
      status: "succeeded",
      result: { responseType: "critique" },
      error: null,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:10.000Z",
    },
  ],
  runSteps: [
    {
      stepId: "step_intent",
      runId: "run_1",
      stepType: "intent",
      status: "succeeded",
      input: { userCommand: "@Cassie critic this" },
      output: { intent: "critic", confidence: 0.91 },
      error: null,
      model: "deepseek-v4-flash",
      promptName: "cassie_intent",
      promptVersion: "2026-05-20",
      startedAt: "2026-05-21T00:00:01.000Z",
      completedAt: "2026-05-21T00:00:02.000Z",
    },
    {
      stepId: "step_research",
      runId: "run_1",
      stepType: "research",
      status: "succeeded",
      input: { researchAngle: "critic" },
      output: { stance: "partially_supported" },
      error: null,
      model: "deepseek-v4-pro",
      promptName: "cassie_research_report",
      promptVersion: "2026-05-20",
      startedAt: "2026-05-21T00:00:03.000Z",
      completedAt: "2026-05-21T00:00:08.000Z",
    },
  ],
  researchRuns: [
    {
      researchRunId: "research_1",
      controlRunId: "run_1",
      angle: "critic",
      status: "succeeded",
      queryPlan: {
        normalizedClaim: "Exa raised $250M.",
        mode: "standard",
        goals: [{ id: "g_verify", kind: "event_validation", question: "Did Exa raise $250M?" }],
      },
      startedAt: "2026-05-21T00:00:03.000Z",
      completedAt: "2026-05-21T00:00:08.000Z",
      error: null,
    },
  ],
  researchQueryJobs: [
    {
      id: "job_w0_q_verify_web",
      researchRunId: "research_1",
      runId: "research_1",
      wave: 0,
      querySpecId: "q_verify_web",
      goalIds: ["g_verify"],
      lane: "web",
      provider: "gemini_google_search",
      query: "\"Exa\" \"$250M\" funding",
      queryKind: "entity_event",
      priority: 0.95,
      maxResults: 5,
      mustExecuteAtomically: true,
      expectedEvidence: "Funding confirmation.",
      rationale: "Verify the core claim.",
      status: "succeeded",
      startedAt: "2026-05-21T00:00:04.000Z",
      completedAt: "2026-05-21T00:00:05.000Z",
      error: null,
    },
  ],
  researchSearchResults: [
    {
      researchRunId: "research_1",
      id: "result_1",
      runId: "research_1",
      queryJobId: "job_w0_q_verify_web",
      queryId: "q_verify_web",
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
      retrievedAt: "2026-05-21T00:00:05.000Z",
      rawText: null,
      snippet: "Exa raised $250M.",
      rank: 1,
      duplicateOf: null,
      metadata: [],
    },
  ],
  researchEvidenceClaims: [
    {
      researchRunId: "research_1",
      id: "claim_1",
      resultId: "result_1",
      queryJobId: "job_w0_q_verify_web",
      queryId: "q_verify_web",
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
    },
  ],
  researchGoalEvidenceLinks: [
    {
      researchRunId: "research_1",
      id: "link_1",
      goalId: "g_verify",
      evidenceClaimId: "claim_1",
      stance: "supports",
      relevance: 0.95,
      strength: 0.8,
      reason: "The claim confirms the funding event.",
      satisfiesEvidenceNeeds: ["Funding confirmation."],
      redFlags: [],
    },
  ],
  researchGoalResolutions: [
    {
      id: "resolution_1",
      researchRunId: "research_1",
      wave: 0,
      goalId: "g_verify",
      status: "resolved_supported",
      confidence: 0.86,
      supportingEvidenceIds: ["claim_1"],
      contradictingEvidenceIds: [],
      contextualEvidenceIds: [],
      unresolvedQuestions: [],
      summary: "Funding is supported.",
      synthesisImplication: "Cassie may treat the event as verified.",
      createdAt: "2026-05-21T00:00:06.000Z",
    },
  ],
  researchContinuationDecisions: [
    {
      id: "decision_1",
      researchRunId: "research_1",
      wave: 0,
      action: "continue_planned",
      reason: "No required goal was contradicted.",
      resolvedGoalIds: ["g_verify"],
      unresolvedBlockingGoalIds: [],
      contradictedGoalIds: [],
      allowedNextGoalIds: [],
      maxAdditionalQueries: 0,
      adaptiveQueryInstructions: [],
      blockedActions: [],
      createdAt: "2026-05-21T00:00:07.000Z",
    },
  ],
  modelCallUsage: [
    {
      id: "usage_1",
      controlRunId: "run_1",
      researchRunId: null,
      runStepId: null,
      purpose: "supervisor_step",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      promptName: "cassie_supervisor",
      promptVersion: "2026-05-20",
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 20,
      cachedTokens: 0,
      totalTokens: 150,
      estimatedCostUsd: null,
      latencyMs: null,
      status: "succeeded",
      error: null,
      createdAt: "2026-05-21T00:00:08.000Z",
    },
  ],
  tradeabilityDecisions: [],
};

describe("run timeline", () => {
  it("formats a nested timeline with tools, visible reasoning, research substeps, and token usage", () => {
    const timeline = formatRunTimeline(snapshot, "run_1");

    expect(timeline).toContain("CASSIE RUN TIMELINE");
    expect(timeline).toContain("[ok] run_1 ok");
    expect(timeline).toContain("|-- [ai] intent [ok] 1.0s");
    expect(timeline).toContain("|   |-- model deepseek-v4-flash");
    expect(timeline).toContain("|   |-- thinking Classify command and source into a bounded Cassie intent.");
    expect(timeline).toContain("|-- [research] research_1 [ok] critic standard 5.0s");
    expect(timeline).toContain("|   |-- claim Exa raised $250M.");
    expect(timeline).toContain("|   |-- [wave 0]");
    expect(timeline).toContain("|   |   |-- [web] q_verify_web web/gemini_google_search [ok] 1.0s atomic p=0.95");
    expect(timeline).toContain("|   |   |   |-- result result_1 news Exa raises $250M");
    expect(timeline).toContain("|   |   |   |-- claim claim_1 medium/direct_secondary Exa raised $250M.");
    expect(timeline).toContain("|   |   |   |   |-- link g_verify supports strength=0.8");
    expect(timeline).toContain("|   |   |-- [goal] g_verify [resolved_supported] c=0.86");
    expect(timeline).toContain("|   |   |-- [controller] continue_planned");
    expect(timeline).toContain("model");
    expect(timeline).toContain("deepseek-v4-pro");
    expect(timeline).toContain("|-- [tokens] total=150 input=100 output=50 reasoning=20 cache=0");
  });
});
