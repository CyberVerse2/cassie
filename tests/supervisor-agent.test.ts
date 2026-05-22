import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import type { AccountStateProvider } from "../packages/execution/account-state.ts";
import { buildSupervisorInstructions } from "../packages/ai/agents/supervisor/agent.ts";
import { createCassieSupervisorTools } from "../packages/ai/agents/supervisor/tools.ts";
import { InMemoryCassieStore } from "../packages/db/store.ts";
import type {
  IntentResult,
  GoalResolution,
  MarketSelection,
  ResearchQueryPlan,
  ResearchReport,
  SignalInterpretation,
  SourcePost,
  SourceProfile,
  Thesis,
  TradeExpressionPlan,
  UserSettings,
} from "../packages/core/schemas/index.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "post_1",
  url: null,
  authorHandle: "example",
  authorName: "Example",
  text: "Solana ETF approval is basically inevitable now. Market is asleep.",
  createdAt: null,
};

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

const thesis: Thesis = {
  claim: "SOL may rally because ETF approval odds are increasing.",
  direction: "bullish",
  mentionedAssets: ["SOL"],
  topics: ["Solana ETF"],
  timeHorizon: "event_based",
  evidenceQuality: "medium",
  manipulationRisk: "medium",
  confidence: 0.82,
};

const sourceProfile: SourceProfile = {
  handle: "example",
  displayName: "Example",
  profileUrl: "https://x.com/example",
  bio: null,
  bioLinks: [],
  accountType: "analyst",
  verificationStatus: null,
  followerCount: null,
  followingCount: null,
  accountAge: null,
  locationSignals: [],
  pinnedPost: null,
  credibility: "medium",
  expertise: ["markets"],
  selfClaims: [],
  provenOutput: [],
  trackRecord: "Test source profile.",
  networkContext: "Test network context.",
  engagementQuality: "unknown",
  recentRelevantActivity: [],
  redFlags: [],
  unresolvedQuestions: [],
  lowDataReasons: [],
  confidenceImpact: "none",
  confidenceImpactReason: "No additional confidence impact in the fixture.",
  confidence: 0.5,
};

const signal: SignalInterpretation = {
  signalType: "explicit_trade",
  containsExplicitThesis: true,
  impliedTheses: ["SOL may rally on ETF approval odds."],
  affectedEntities: ["Solana"],
  affectedSectors: ["crypto"],
  directTradability: "direct",
  suggestedResearchAngles: ["Verify the catalyst and check whether it is priced."],
  leadQuality: "tradable_now",
  summary: "Explicit SOL trade signal.",
  confidence: 0.9,
};

const queryPlan: ResearchQueryPlan = {
  version: "research-query-plan/v1",
  normalizedClaim: thesis.claim,
  signalType: "explicit_trade",
  mode: "standard",
  assets: ["SOL"],
  topics: ["Solana ETF"],
  sourceHandle: "example",
  sourceName: "Example",
  scores: {
    specificity: 0.8,
    marketLinkage: 0.9,
    sourceValue: 0.5,
    urgency: 0.5,
    risk: 0.4,
    novelty: 0.5,
    expectedValueOfResearch: 0.8,
  },
  goals: [
    {
      id: "g_verify",
      kind: "event_validation",
      question: "Is the SOL ETF catalyst real?",
      decisionUse: "validate_or_kill_thesis",
      priority: 0.7,
      mustResolve: false,
      lanes: ["web", "x"],
      evidenceNeeds: ["Credible web and X context."],
      disconfirmingQuestions: [],
      resolutionCriteria: {
        supportedIf: "Credible sources support the catalyst.",
        contradictedIf: "Credible sources refute the catalyst.",
        unresolvedIf: "Sources are inconclusive.",
      },
      budget: { maxQueries: 2, maxResults: 10, wave: 0 },
      stopWhen: [],
    },
  ],
  queryBatches: [
    {
      wave: 0,
      name: "Verification",
      purpose: "Verify the catalyst.",
      queries: [
        {
          id: "q_web",
          goalIds: ["g_verify"],
          lane: "web",
          queryKind: "exact_claim",
          query: "SOL ETF approval odds",
          priority: 0.7,
          maxResults: 5,
          expectedEvidence: "Credible web evidence.",
          rationale: "Verify the claim.",
        },
        {
          id: "q_x",
          goalIds: ["g_verify"],
          lane: "x",
          queryKind: "social_momentum",
          query: "SOL ETF approval odds",
          priority: 0.7,
          maxResults: 5,
          expectedEvidence: "X context.",
          rationale: "Check social context.",
        },
      ],
    },
  ],
  synthesisContract: {
    requiredGoalIds: [],
    cannotConcludeIfUnresolved: [],
  },
};

const goalResolution: GoalResolution = {
  goalId: "g_verify",
  status: "partially_resolved",
  confidence: 0.7,
  supportingEvidenceIds: [],
  contradictingEvidenceIds: [],
  contextualEvidenceIds: [],
  unresolvedQuestions: [],
  summary: "The catalyst is plausible but not confirmed.",
  synthesisImplication: "Keep conviction capped.",
};

const researchReport: ResearchReport = {
  claim: thesis.claim,
  normalizedThesis: thesis.claim,
  stance: "partially_supported",
  evidenceQuality: "medium",
  socialContext: {
    momentum: "high",
    crowdingSignal: "medium",
    manipulationSignal: "medium",
    summary: "Crowded rumor with enough market relevance to route cautiously.",
  },
  socialSignal: {
    sourceCredibility: "medium",
    endorserReputation: "Test source.",
    entityResolution: {
      resolvedEntity: "Solana",
      confidence: "high",
      rationale: "SOL is directly referenced.",
      unverifiedAssumptions: [],
    },
    personProjectDossier: {
      identifiedPeople: [],
      evidenceSummary: "No people to resolve.",
      openQuestions: [],
    },
    smartEngagerSignal: {
      quality: "unknown",
      summary: "Not evaluated in this fixture.",
      notableAccounts: [],
    },
    leadQuality: "tradable_now",
    nextResearchActions: [],
  },
  bullCase: ["ETF narrative could support SOL demand."],
  bearCase: ["No primary approval source."],
  contradictions: ["Approval is not confirmed."],
  evidence: [],
  warnings: ["NO_PRIMARY_SOURCE"],
  confidence: 0.7,
  researchConclusion: "claim_plausible_but_unconfirmed",
  recommendedResearchAction: "proceed_with_caution",
  publicSummary: "Plausible but unconfirmed.",
  fullResearchBrief: "No primary source confirms approval.",
};

const marketSelection: MarketSelection = {
  selectedMarket: {
    venue: "hyperliquid",
    instrument: "perp",
    side: "long",
    symbol: "SOL",
    liquidityScore: 0.9,
    spreadBps: 10,
    estimatedSlippageBps: 10,
    minOrderSizeUsd: 10,
    thesisFit: 0.85,
    reason: "Direct SOL perp expression.",
  },
  rejectedCandidates: [],
  noTradeReason: null,
};

const tradeExpression: TradeExpressionPlan = {
  signal: "SOL ETF rumor",
  coreInterpretation: "The clean expression is direct SOL exposure if the catalyst is still underpriced.",
  directAsset: "SOL",
  directAssetTradable: true,
  highestPurityExpression: "Long SOL perp while the ETF approval catalyst remains unresolved.",
  publicMarketReadThrough: "strong",
  candidates: [
    {
      instrument: "SOL perp",
      expression: "long",
      thesis: "SOL may rally if ETF approval odds are underpriced.",
      causalDirectness: 0.9,
      liquidity: 0.9,
      surprise: 0.5,
      timing: 0.7,
      crowdingRisk: 0.4,
      downsideAsymmetry: 0.6,
      evidenceQuality: 0.6,
      expectedEdge: 0.72,
      tradableNow: true,
      rejectionReason: null,
      invalidation: ["Primary sources refute near-term approval."],
      evidenceNeeded: ["Primary ETF approval timing evidence."],
    },
  ],
  decision: "route_to_market_router",
  reason: "The asset is liquid and directly maps to the researched catalyst.",
  marketRouterInstructions: "Prefer direct SOL perps over indirect read-throughs.",
};

class FakeAi implements StructuredAiClient {
  readonly calls: string[] = [];

  async generateObject<T>(input: { name: string }): Promise<T> {
    this.calls.push(input.name);
    const outputs: Record<string, unknown> = {
      cassie_intent: {
        intent: "trade",
        executionRequested: true,
        counterThesis: false,
        specificAsset: "SOL",
        specificVenue: "hyperliquid",
        userSizeOverrideUsd: null,
        confidence: 0.95,
      } satisfies IntentResult,
      cassie_signal: signal,
      cassie_thesis: thesis,
      cassie_source_profile: sourceProfile,
      cassie_research_query_plan: queryPlan,
      cassie_goal_resolution: [goalResolution],
      cassie_research_report: researchReport,
      cassie_trade_expression: tradeExpression,
      cassie_market_selection: marketSelection,
      cassie_critique: {
        strongestObjection: "No primary source confirms approval.",
        secondaryObjections: ["Social momentum can be reflexive but not factual."],
        thesisTradable: true,
        fadeIsCleaner: false,
        finalCritique: "Treat this as rumor-driven until primary confirmation appears.",
      },
    };
    return outputs[input.name] as T;
  }
}

class ThrowingAccountStateProvider implements AccountStateProvider {
  async getAccountState(): Promise<never> {
    throw new Error("account state unavailable");
  }
}

async function executeTool<T>(toolDefinition: unknown, input: unknown): Promise<T> {
  const execute = (toolDefinition as { execute: (input: unknown, options?: unknown) => Promise<T> }).execute;
  return execute(input, {});
}

describe("AI SDK supervisor agent", () => {
  it("instructs the supervisor to use a flexible governed loop", () => {
    const instructions = buildSupervisorInstructions();

    expect(instructions).toContain("You may choose tools dynamically");
    expect(instructions).toContain("Do not ask the user follow-up questions mid-run");
    expect(instructions).toContain("Treat ambiguity conservatively");
    expect(instructions).toContain("Never invent market candidates, prices, account state, or risk approvals");
    expect(instructions).toContain("Always use finalize_run");
  });

  it("records bounded tool steps and creates a pending trade ticket", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    const intent = await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal: interpreted,
      thesis: extracted,
      researchAngle: "balanced",
    });
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
      researchReport: report,
    });
    const selected = await executeTool<MarketSelection>(tools.select_market, {
      thesis: extracted,
      researchReport: report,
      tradeExpression: expression,
    });
    const risk = await executeTool(tools.risk_check, {
      marketSelection: selected,
      sizeUsd: intent.userSizeOverrideUsd,
    });
    const ticket = await executeTool<{ ticketId: string }>(tools.create_trade_ticket, {
      thesis: extracted,
      marketSelection: selected,
      riskDecision: risk,
      sizeUsd: intent.userSizeOverrideUsd,
    });
    await executeTool(tools.finalize_run, {
      responseType: "trade_ticket",
      publicSummary: "Created a trade ticket for review.",
      tradeTicket: { ticketId: ticket.ticketId },
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.approvalState).toBe("pending");
    expect(state.researchReports).toHaveLength(1);
    expect(state.runSteps.map((step) => step.stepType)).toEqual(
      expect.arrayContaining(["intent", "signal", "thesis", "research", "trade_expression", "market_selection", "risk", "ticket", "final"]),
    );
    expect(state.executionJobs).toHaveLength(0);
  });

  it("does not require account state before tools need risk evaluation", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: { ...settings, walletAddress: null },
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
      accountStateProvider: new ThrowingAccountStateProvider(),
    });

    await expect(executeTool<IntentResult>(tools.classify_intent, {})).resolves.toMatchObject({
      intent: "trade",
    });
    await executeTool(tools.select_market, {
      thesis,
      researchReport,
      tradeExpression,
    });
    await expect(executeTool(tools.risk_check, {
      marketSelection,
      sizeUsd: null,
    })).rejects.toThrow("account state unavailable");
  });

  it("rejects risk checks without a persisted usable market selection", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    await expect(executeTool(tools.risk_check, {
      marketSelection,
      sizeUsd: null,
    })).rejects.toThrow("Risk check requires a persisted usable market selection.");
  });

  it("rejects trade ticket creation without a persisted non-rejected risk decision", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal });
    await executeTool(tools.select_market, {
      thesis: extracted,
      researchReport,
      tradeExpression,
    });
    await expect(executeTool(tools.create_trade_ticket, {
      thesis: extracted,
      marketSelection,
      riskDecision: { decision: "approve", adjustedSizeUsd: 50 },
      sizeUsd: null,
    })).rejects.toThrow("Trade ticket creation requires a persisted non-rejected risk decision.");
  });

  it("allows early grounded analysis finalization without market or risk state", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie analyze this",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal });
    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal,
      thesis: extracted,
      researchAngle: "balanced",
    });

    await expect(executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: "No clean trade yet; evidence remains capped.",
      thesis: extracted,
      researchReport: report,
    })).resolves.toMatchObject({
      responseType: "analysis",
      publicSummary: expect.stringContaining("Plausible but unconfirmed"),
    });
  });

  it("rejects trade-ticket finalization without a persisted ticket", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    await expect(executeTool(tools.finalize_run, {
      responseType: "trade_ticket",
      publicSummary: "Created a ticket.",
      tradeTicket: { ticketId: "missing_ticket" },
    })).rejects.toThrow("Trade-ticket finalization requires a persisted trade ticket.");
  });

  it("deduplicates duplicate supervisor tool calls for the same step", async () => {
    const store = new InMemoryCassieStore();
    const ai = new FakeAi();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai,
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    const [first, second] = await Promise.all([
      executeTool<SignalInterpretation>(tools.interpret_signal, {}),
      executeTool<SignalInterpretation>(tools.interpret_signal, {}),
    ]);

    expect(first).toEqual(second);
    expect(ai.calls.filter((call) => call === "cassie_signal")).toHaveLength(1);
    const steps = await store.getRunSteps(run.runId);
    expect(steps.filter((step) => step.stepType === "signal")).toHaveLength(1);
  });

  it("uses important AI for research synthesis and critique, but cheap AI for market selection", async () => {
    const store = new InMemoryCassieStore();
    const cheapAi = new FakeAi();
    const importantAi = new FakeAi();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie critic this and find the market",
      sourcePost,
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
      deps: {
        cheapAi,
        importantAi,
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal });
    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal,
      thesis: extracted,
      researchAngle: "critic",
    });
    await executeTool(tools.critique_thesis, {
      thesis,
      researchReport: report,
    });
    await executeTool(tools.plan_trade_expression, {
      signal,
      thesis,
      researchReport: report,
    });
    await executeTool(tools.select_market, {
      thesis,
      researchReport: report,
      tradeExpression,
    });

    expect(importantAi.calls).toEqual([
      "cassie_source_profile",
      "cassie_research_query_plan",
      "cassie_goal_resolution",
      "cassie_goal_resolution",
      "cassie_research_report",
      "cassie_critique",
      "cassie_trade_expression",
    ]);
    expect(cheapAi.calls).toEqual(["cassie_thesis", "cassie_market_selection"]);
    const steps = await store.getRunSteps(run.runId);
    expect(steps.map((step) => ({ type: step.stepType, model: step.model }))).toEqual([
      { type: "thesis", model: "deepseek/deepseek-v4-flash" },
      { type: "research", model: "gemini-3.5-flash" },
      { type: "critique", model: "gemini-3.5-flash" },
      { type: "trade_expression", model: "gemini-3.5-flash" },
      { type: "market_selection", model: "deepseek/deepseek-v4-flash" },
    ]);
  });

  it("uses persisted canonical outputs instead of lossy model-copied tool inputs", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost,
    });
    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal });
    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal,
      thesis: extracted,
      researchAngle: "critic",
    });
    const lossyReport: ResearchReport = {
      ...report,
      stance: "supported",
      evidence: [],
      warnings: [],
      publicSummary: "Lossy copied summary.",
    };

    await executeTool(tools.critique_thesis, {
      thesis: { ...thesis, claim: "Lossy copied thesis." },
      researchReport: lossyReport,
    });
    await executeTool(tools.plan_trade_expression, {
      signal,
      thesis,
      researchReport: lossyReport,
    });

    const steps = await store.getRunSteps(run.runId);
    expect(steps.find((step) => step.stepType === "critique")?.input).toMatchObject({
      thesis: extracted,
      researchReport: report,
    });
    expect(steps.find((step) => step.stepType === "trade_expression")?.input).toMatchObject({
      thesis: extracted,
      researchReport: report,
    });
  });
});
