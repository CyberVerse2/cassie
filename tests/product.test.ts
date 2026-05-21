import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../src/ai.ts";
import { CassieProduct } from "../src/product.ts";
import type {
  AccountState,
  Critique,
  IntentResult,
  ExecutionJob,
  MarketSelection,
  ResearchReport,
  SourcePost,
  Thesis,
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
    founderDossier: {
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
      cassie_thesis: thesis,
      cassie_research_report: researchReport,
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
      cassie_thesis: thesis,
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
