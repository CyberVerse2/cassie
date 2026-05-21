import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import type { AccountStateProvider } from "../packages/execution/account-state.ts";
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
  Thesis,
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
      cassie_research_query_plan: queryPlan,
      cassie_goal_resolution: [goalResolution],
      cassie_research_report: researchReport,
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
    const selected = await executeTool<MarketSelection>(tools.select_market, {
      thesis: extracted,
      researchReport: report,
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
      expect.arrayContaining(["intent", "signal", "thesis", "research", "market_selection", "risk", "ticket", "final"]),
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
    await expect(executeTool(tools.risk_check, {
      marketSelection,
      sizeUsd: null,
    })).rejects.toThrow("account state unavailable");
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

    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal,
      thesis,
      researchAngle: "critic",
    });
    await executeTool(tools.critique_thesis, {
      thesis,
      researchReport: report,
    });
    await executeTool(tools.select_market, {
      thesis,
      researchReport: report,
    });

    expect(importantAi.calls).toEqual([
      "cassie_research_query_plan",
      "cassie_goal_resolution",
      "cassie_goal_resolution",
      "cassie_research_report",
      "cassie_critique",
    ]);
    expect(cheapAi.calls).toEqual(["cassie_market_selection"]);
    const steps = await store.getRunSteps(run.runId);
    expect(steps.map((step) => ({ type: step.stepType, model: step.model }))).toEqual([
      { type: "research", model: "gpt-5.5" },
      { type: "critique", model: "gpt-5.5" },
      { type: "market_selection", model: "deepseek/deepseek-v4-flash" },
    ]);
  });
});
