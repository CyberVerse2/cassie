import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { createCassieSupervisorTools } from "../packages/ai/agents/supervisor/tools.ts";
import { InMemoryCassieStore } from "../packages/db/store.ts";
import type {
  Critique,
  GoalResolution,
  IntentResult,
  InverseThesis,
  MarketSelection,
  ResearchQueryPlan,
  ResearchReport,
  RiskDecision,
  SignalInterpretation,
  SourcePost,
  Thesis,
  UserSettings,
} from "../packages/core/schemas/index.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "post_1",
  url: "https://x.com/example/status/post_1",
  authorHandle: "example",
  authorName: "Example",
  text: "Solana ETF approval is basically inevitable now. Market is asleep.",
  createdAt: "2026-05-20T12:00:00Z",
};

const baseSettings: UserSettings = {
  userId: "user_1",
  walletAddress: "0x0000000000000000000000000000000000000000",
  allowedVenues: ["hyperliquid"],
  allowedAssets: ["SOL"],
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
  evidenceQuality: "weak",
  manipulationRisk: "medium",
  confidence: 0.66,
};

const signal: SignalInterpretation = {
  signalType: "explicit_trade",
  containsExplicitThesis: true,
  impliedTheses: ["SOL ETF approval odds may be underpriced."],
  affectedEntities: ["Solana"],
  affectedSectors: ["crypto"],
  directTradability: "direct",
  suggestedResearchAngles: ["Verify catalyst and check disconfirmation."],
  leadQuality: "tradable_now",
  summary: "Explicit SOL catalyst signal.",
  confidence: 0.88,
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
  confidence: 0.62,
  supportingEvidenceIds: [],
  contradictingEvidenceIds: [],
  contextualEvidenceIds: [],
  unresolvedQuestions: [],
  summary: "Plausible but unconfirmed.",
  synthesisImplication: "Keep conviction capped.",
};

const inverseThesis: InverseThesis = {
  originalThesis: thesis,
  inverseClaim: "SOL may sell off because ETF approval is unconfirmed and crowded.",
  inverseDirection: "bearish",
  mentionedAssets: ["SOL"],
  topics: ["Solana ETF"],
  timeHorizon: "event_based",
  confidence: 0.7,
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
    summary: "Active social discussion, mostly repeating one rumor.",
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
  bullCase: ["ETF filings are being discussed."],
  bearCase: ["No primary approval source."],
  contradictions: ["Discussion exists, approval is not confirmed."],
  evidence: [],
  warnings: ["NO_PRIMARY_SOURCE", "HIGH_SOCIAL_MOMENTUM"],
  confidence: 0.62,
  researchConclusion: "claim_plausible_but_unconfirmed",
  recommendedResearchAction: "proceed_with_caution",
  publicSummary: "Plausible but unconfirmed.",
  fullResearchBrief: "No primary source confirms approval.",
};

const critique: Critique = {
  strongestObjection: "No primary source confirms approval.",
  secondaryObjections: ["Narrative is crowded.", "The trade may already be priced."],
  thesisTradable: true,
  fadeIsCleaner: false,
  finalCritique: "Treat this as rumor-driven until a primary source appears.",
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
    thesisFit: 0.82,
    reason: "Direct liquid SOL expression.",
  },
  rejectedCandidates: [],
  noTradeReason: null,
};

class ScenarioAi implements StructuredAiClient {
  constructor(private readonly intent: IntentResult["intent"]) {}

  async generateObject<T>(input: { name: string }): Promise<T> {
    const outputs: Record<string, unknown> = {
      cassie_intent: {
        intent: this.intent,
        executionRequested: this.intent === "trade" || this.intent === "countertrade",
        counterThesis: this.intent === "countertrade",
        specificAsset: null,
        specificVenue: null,
        userSizeOverrideUsd: null,
        confidence: 0.92,
      } satisfies IntentResult,
      cassie_signal: signal,
      cassie_thesis: thesis,
      cassie_inverse_thesis: inverseThesis,
      cassie_research_query_plan: queryPlan,
      cassie_goal_resolution: [goalResolution],
      cassie_research_report: researchReport,
      cassie_market_selection: marketSelection,
      cassie_critique: critique,
    };

    return outputs[input.name] as T;
  }
}

async function createScenario(intent: IntentResult["intent"], settings: UserSettings = baseSettings) {
  const store = new InMemoryCassieStore();
  await store.upsertUserSettings(settings);
  const run = await store.createRun({
    userId: settings.userId,
    userCommand: `@Cassie ${intent}`,
    sourcePost,
  });
  const tools = createCassieSupervisorTools({
    store,
    run,
    userSettings: settings,
    accountState: {
      userId: settings.userId,
      availableBalanceUsd: 500,
      openExposureUsd: 0,
      dailyLossUsd: 0,
      openOrdersUsd: 0,
    },
    deps: {
      ai: new ScenarioAi(intent),
      marketData: {
        async findCandidates() {
          return [marketSelection.selectedMarket!];
        },
      },
      researchLanes: {
        async runOpenAiWebSearch() {
          return { lane: "openai_search" as const, evidence: [], warnings: [] };
        },
        async runGrokXSearch() {
          return { lane: "x_search" as const, evidence: [], warnings: [] };
        },
      },
    },
  });

  return { store, run, tools };
}

async function executeTool<T>(toolDefinition: unknown, input: unknown): Promise<T> {
  const execute = (toolDefinition as { execute: (input: unknown, options?: unknown) => Promise<T> }).execute;
  return execute(input, {});
}

describe("supervisor scenario coverage", () => {
  it("handles critic requests without creating trade tickets", async () => {
    const { store, run, tools } = await createScenario("critic");
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal: interpreted,
      thesis: extracted,
      researchAngle: "critic",
    });
    const result = await executeTool<Critique>(tools.critique_thesis, {
      thesis: extracted,
      researchReport: report,
    });
    await executeTool(tools.finalize_run, {
      responseType: "critique",
      result: {
        publicSummary: result.finalCritique,
        critique: result,
        researchReport: report,
      },
    });

    const state = await store.load();
    expect(state.tradeTickets).toHaveLength(0);
    expect(state.researchReports).toHaveLength(1);
    await expect(store.getRun(run.runId)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("handles countertrade requests through inverse thesis before ticket creation", async () => {
    const { store, tools } = await createScenario("countertrade");
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const inverse = await executeTool<InverseThesis>(tools.extract_inverse_thesis, { thesis: extracted });
    const counterThesis = {
      ...extracted,
      claim: inverse.inverseClaim,
      direction: inverse.inverseDirection,
      mentionedAssets: inverse.mentionedAssets,
      topics: inverse.topics,
      timeHorizon: inverse.timeHorizon,
      confidence: inverse.confidence,
    } satisfies Thesis;
    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal: interpreted,
      thesis: counterThesis,
      researchAngle: "counter",
    });
    const selected = await executeTool<MarketSelection>(tools.select_market, {
      thesis: counterThesis,
      researchReport: report,
    });
    const risk = await executeTool<RiskDecision>(tools.risk_check, {
      marketSelection: selected,
      sizeUsd: null,
    });
    const ticket = await executeTool<{ ticketId: string }>(tools.create_trade_ticket, {
      thesis: counterThesis,
      marketSelection: selected,
      riskDecision: risk,
      sizeUsd: null,
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.ticketId).toBe(ticket.ticketId);
    expect(state.runSteps.map((step) => step.stepType)).toEqual(
      expect.arrayContaining(["inverse_thesis", "research", "market_selection", "risk", "ticket"]),
    );
  });

  it("finalizes rejected-risk trade requests without creating a ticket", async () => {
    const { store, run, tools } = await createScenario("trade", {
      ...baseSettings,
      allowedAssets: ["BTC"],
    });
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
    const risk = await executeTool<RiskDecision>(tools.risk_check, {
      marketSelection: selected,
      sizeUsd: null,
    });

    expect(risk.decision).toBe("reject");
    await executeTool(tools.finalize_run, {
      responseType: "analysis",
      result: {
        publicSummary: risk.decision === "reject" ? risk.reason : "Risk check passed.",
        thesis: extracted,
        marketSelection: selected,
      },
    });

    const state = await store.load();
    expect(state.tradeTickets).toHaveLength(0);
    await expect(store.getRun(run.runId)).resolves.toMatchObject({ status: "succeeded" });
  });
});
