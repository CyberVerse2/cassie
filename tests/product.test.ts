import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../src/ai.ts";
import { CassieProduct } from "../src/product.ts";
import type {
  AccountState,
  Critique,
  IntentResult,
  ExecutionJob,
  MarketSelection,
  ResearchQueryPlan,
  ResearchReport,
  SignalInterpretation,
  SourcePost,
  Thesis,
  TradeExpressionPlan,
  TradeTicket,
  UserSettings,
} from "../src/schemas.ts";
import type { ExecutionClient } from "../src/execution.ts";
import { InMemoryCassieStore } from "../src/store.ts";
import { StaticAccountStateProvider } from "../src/account-state.ts";
import type { ExecutionJobQueue } from "../src/jobs/execution-jobs.ts";

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
  confidence: 0.8,
};

const signal: SignalInterpretation = {
  signalType: "rumor",
  containsExplicitThesis: false,
  impliedTheses: ["SOL may rally if ETF approval odds are improving."],
  affectedEntities: ["Solana", "SOL"],
  affectedSectors: ["crypto", "ETF"],
  directTradability: "direct",
  suggestedResearchAngles: ["Verify whether ETF approval odds have changed."],
  leadQuality: "soft_signal",
  summary: "A social post implies a catalyst but does not prove it.",
  confidence: 0.8,
};

const marketSelection: MarketSelection = {
  selectedMarket: {
    venue: "hyperliquid",
    instrument: "perp",
    side: "long",
    symbol: "SOL",
    liquidityScore: 1,
    spreadBps: 10,
    estimatedSlippageBps: 10,
    minOrderSizeUsd: 10,
    thesisFit: 0.9,
    reason: "Direct SOL expression.",
  },
  rejectedCandidates: [],
  noTradeReason: null,
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
    summary: "Crowded rumor.",
  },
  socialSignal: {
    sourceCredibility: "medium",
    endorserReputation: "Fixture source has unknown reputation.",
    entityResolution: {
      resolvedEntity: "SOL",
      confidence: "high",
      rationale: "The source post directly mentions Solana/SOL.",
      unverifiedAssumptions: [],
    },
    personProjectDossier: {
      identifiedPeople: [],
      evidenceSummary: "No founder dossier required for this SOL fixture.",
      openQuestions: [],
    },
    smartEngagerSignal: {
      quality: "unknown",
      summary: "No engagement graph supplied.",
      notableAccounts: [],
    },
    leadQuality: "soft_signal",
    nextResearchActions: ["Verify the catalyst with a primary source."],
  },
  bullCase: [],
  bearCase: [],
  contradictions: [],
  evidence: [],
  warnings: ["NO_PRIMARY_SOURCE"],
  confidence: 0.7,
  researchConclusion: "claim_plausible_but_unconfirmed",
  recommendedResearchAction: "proceed_with_caution",
  publicSummary: "Plausible but unconfirmed.",
  fullResearchBrief: "No primary source.",
};

const tradeExpressionPlan: TradeExpressionPlan = {
  signal: "SOL ETF approval odds may be increasing.",
  coreInterpretation: "Potential catalyst for SOL if verified.",
  directAsset: "SOL",
  directAssetTradable: true,
  highestPurityExpression: "Long SOL if the ETF catalyst is verified and not already priced.",
  publicMarketReadThrough: "strong",
  candidates: [
    {
      instrument: "SOL perp",
      expression: "long",
      thesis: "SOL benefits directly from higher ETF approval odds.",
      causalDirectness: 0.9,
      liquidity: 0.9,
      surprise: 0.5,
      timing: 0.7,
      crowdingRisk: 0.4,
      downsideAsymmetry: 0.5,
      evidenceQuality: 0.6,
      expectedEdge: 0.62,
      tradableNow: true,
      rejectionReason: null,
      invalidation: ["No active ETF process exists."],
      evidenceNeeded: ["Primary evidence that approval odds changed."],
    },
  ],
  decision: "route_to_market_router",
  reason: "A direct liquid SOL expression exists.",
  marketRouterInstructions: "Search for liquid SOL venues only.",
};

const queryPlan: ResearchQueryPlan = {
  version: "research-query-plan/v1",
  normalizedClaim: thesis.claim,
  signalType: signal.signalType,
  mode: "standard",
  assets: thesis.mentionedAssets,
  topics: thesis.topics,
  sourceHandle: sourcePost.authorHandle,
  sourceName: sourcePost.authorName,
  scores: {
    specificity: 0.8,
    marketLinkage: 0.8,
    sourceValue: 0.5,
    urgency: 0.5,
    risk: 0.5,
    novelty: 0.5,
    expectedValueOfResearch: 0.7,
  },
  goals: [
    {
      id: "g_verify",
      kind: "event_validation",
      question: "Is the SOL ETF catalyst real?",
      decisionUse: "validate_or_kill_thesis",
      priority: 0.9,
      mustResolve: true,
      lanes: ["web", "x"],
      evidenceNeeds: ["Primary or credible evidence for the ETF catalyst."],
      disconfirmingQuestions: ["Is the catalyst refuted or stale?"],
      resolutionCriteria: {
        supportedIf: "Credible current evidence confirms the catalyst.",
        contradictedIf: "Primary sources refute the catalyst.",
        unresolvedIf: "Only social repetition is available.",
      },
      budget: { maxQueries: 2, maxResults: 20, wave: 0 },
      stopWhen: ["claim is refuted"],
    },
  ],
  queryBatches: [
    {
      wave: 0,
      name: "Verify catalyst",
      purpose: "Verify the SOL ETF catalyst.",
      queries: [
        {
          id: "q_verify_web",
          goalIds: ["g_verify"],
          lane: "web",
          queryKind: "primary_source",
          query: "Solana ETF approval odds official source",
          priority: 0.9,
          maxResults: 10,
          expectedEvidence: "Official or reputable evidence.",
          rationale: "The thesis depends on the catalyst being real.",
        },
        {
          id: "q_verify_x",
          goalIds: ["g_verify"],
          lane: "x",
          queryKind: "social_momentum",
          query: "Solana ETF approval rumor refuted",
          priority: 0.8,
          maxResults: 10,
          expectedEvidence: "Social confirmation or refutation.",
          rationale: "X can surface fast refutations and origin posts.",
        },
      ],
    },
  ],
  synthesisContract: {
    requiredGoalIds: ["g_verify"],
    cannotConcludeIfUnresolved: ["g_verify"],
  },
};

class FakeAi implements StructuredAiClient {
  async generateObject<T>(input: { name: string }): Promise<T> {
    const outputs: Record<string, unknown> = {
      cassie_intent: {
        intent: "trade",
        executionRequested: true,
        counterThesis: false,
        specificAsset: null,
        specificVenue: null,
        userSizeOverrideUsd: null,
        confidence: 0.95,
      } satisfies IntentResult,
      cassie_signal: signal,
      cassie_thesis: thesis,
      cassie_research_query_plan: queryPlan,
      cassie_research_report: researchReport,
      cassie_trade_expression: tradeExpressionPlan,
      cassie_market_selection: marketSelection,
    };

    return outputs[input.name] as T;
  }
}

class FakeCriticAi implements StructuredAiClient {
  async generateObject<T>(input: { name: string }): Promise<T> {
    const outputs: Record<string, unknown> = {
      cassie_intent: {
        intent: "critic",
        executionRequested: false,
        counterThesis: true,
        specificAsset: null,
        specificVenue: null,
        userSizeOverrideUsd: null,
        confidence: 0.95,
      } satisfies IntentResult,
      cassie_signal: signal,
      cassie_thesis: thesis,
      cassie_research_query_plan: queryPlan,
      cassie_research_report: researchReport,
      cassie_critique: {
        strongestObjection: "There is no primary source confirming the catalyst.",
        secondaryObjections: ["The post is social sentiment, not hard evidence."],
        thesisTradable: false,
        fadeIsCleaner: false,
        finalCritique: "Treat this as weak narrative evidence unless corroborated.",
      } satisfies Critique,
    };

    return outputs[input.name] as T;
  }
}

class ThrowingAccountStateProvider {
  async getAccountState(): Promise<AccountState> {
    throw new Error("Account state should not be requested.");
  }
}

class FakeExecutionClient implements ExecutionClient {
  async execute(ticket: TradeTicket) {
    return {
      venueOrderId: `order_${ticket.ticketId}`,
      filledSizeUsd: ticket.sizeUsd,
      averagePrice: 100,
    };
  }
}

class FakeExecutionJobQueue implements ExecutionJobQueue {
  async enqueue(job: ExecutionJob) {
    return { executionJobId: job.jobId, graphileJobId: "graphile_job_1" };
  }
}

describe("CassieProduct", () => {
  it("processes a critic mention without requiring account state", async () => {
    const store = new InMemoryCassieStore();
    const product = new CassieProduct(
      store,
      {
        ai: new FakeCriticAi(),
        marketData: { async findCandidates() { return [marketSelection.selectedMarket!]; } },
        researchLanes: {
          async runOpenAiWebSearch() { return { lane: "openai_search", evidence: [], warnings: [] }; },
          async runGrokXSearch() { return { lane: "x_search", evidence: [], warnings: [] }; },
        },
      },
      new FakeExecutionClient(),
      new ThrowingAccountStateProvider(),
      new FakeExecutionJobQueue(),
    );

    await product.upsertSettings({
      ...settings,
      walletAddress: null,
    });
    const processed = await product.processMention({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost,
    });

    expect(processed.run.responseType).toBe("critique");
    expect(processed.state.tradeTickets).toHaveLength(0);
  });

  it("processes a mention, stores a ticket, and executes after approval", async () => {
    const store = new InMemoryCassieStore();
    const product = new CassieProduct(
      store,
      {
        ai: new FakeAi(),
        marketData: { async findCandidates() { return [marketSelection.selectedMarket!]; } },
        researchLanes: {
          async runOpenAiWebSearch() { return { lane: "openai_search", evidence: [], warnings: [] }; },
          async runGrokXSearch() { return { lane: "x_search", evidence: [], warnings: [] }; },
        },
      },
      new FakeExecutionClient(),
      new StaticAccountStateProvider({
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      }),
      new FakeExecutionJobQueue(),
    );

    await product.upsertSettings(settings);
    const processed = await product.processMention({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    expect(processed.run.responseType).toBe("trade_ticket");
    const ticket = processed.state.tradeTickets[0];
    expect(ticket?.approvalState).toBe("pending");

    await product.approveTicket(ticket!.ticketId);
    await product.processNextExecutionJob();
    const state = await product.state();
    expect(state.tradeTickets[0]?.approvalState).toBe("approved");
    expect(state.executionJobs[0]?.status).toBe("succeeded");
  });
});
