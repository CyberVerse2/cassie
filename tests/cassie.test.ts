import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../src/ai.ts";
import type {
  IntentResult,
  MarketSelection,
  ResearchQueryPlan,
  ResearchReport,
  SignalInterpretation,
  SourcePost,
  Thesis,
  UserSettings,
} from "../src/schemas.ts";
import { runCassie } from "../src/supervisor.ts";
import { MissingAiDependencyError, OpenAiStructuredClient } from "../src/ai.ts";
import { evaluateRisk } from "../src/tools/risk.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "post_1",
  url: "https://x.com/example/status/post_1",
  authorHandle: "example",
  authorName: "Example",
  text: "Solana ETF approval is basically inevitable now. Market is asleep.",
  createdAt: "2026-05-20T12:00:00Z",
};

const userSettings: UserSettings = {
  userId: "user_1",
  walletAddress: "0x0000000000000000000000000000000000000000",
  allowedVenues: ["hyperliquid", "polymarket"],
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
  claim: "SOL may rally because Solana ETF approval odds are increasing.",
  direction: "bullish",
  mentionedAssets: ["SOL"],
  topics: ["Solana ETF"],
  timeHorizon: "event_based",
  evidenceQuality: "weak",
  manipulationRisk: "medium",
  confidence: 0.66,
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
  summary: "A social post implies a possible catalyst rather than proving one.",
  confidence: 0.8,
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
    endorserReputation: "The source appears crypto-native but reputation is not fully verified in this fixture.",
    entityResolution: {
      resolvedEntity: "SOL",
      confidence: "high",
      rationale: "The post directly discusses Solana ETF approval odds.",
      unverifiedAssumptions: [],
    },
    personProjectDossier: {
      identifiedPeople: [],
      evidenceSummary: "No founder-quality claim is required for this fixture.",
      openQuestions: [],
    },
    smartEngagerSignal: {
      quality: "unknown",
      summary: "No engagement graph supplied.",
      notableAccounts: [],
    },
    leadQuality: "soft_signal",
    nextResearchActions: ["Find a primary source confirming ETF approval odds."],
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

class FakeAi implements StructuredAiClient {
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
      cassie_research_query_plan: queryPlan,
      cassie_inverse_thesis: {
        originalThesis: thesis,
        inverseClaim: "SOL may sell off because ETF approval is unconfirmed and crowded.",
        inverseDirection: "bearish",
        mentionedAssets: ["SOL"],
        topics: ["Solana ETF"],
        timeHorizon: "event_based",
        confidence: 0.7,
      },
      cassie_research_report: researchReport,
      cassie_market_selection: marketSelection,
      cassie_critique: {
        strongestObjection: "No primary source confirms approval.",
        secondaryObjections: ["Narrative is crowded.", "The trade may already be priced."],
        thesisTradable: true,
        fadeIsCleaner: false,
        finalCritique: "Treat this as rumor-driven until a primary source appears.",
      },
    };

    return outputs[input.name] as T;
  }
}

const deps = (intent: IntentResult["intent"]) => ({
  ai: new FakeAi(intent),
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
});

describe("Cassie supervisor", () => {
  it("creates a trade ticket for trade intent after research, market, and risk", async () => {
    const result = await runCassie({
      deps: deps("trade"),
      sourcePost,
      userSettings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
      userCommand: "@Cassie get me in",
    });

    expect(result.responseType).toBe("trade_ticket");
    if (result.responseType !== "trade_ticket") {
      throw new Error("Expected trade_ticket response.");
    }
    expect(result.tradeTicket.venue).toBe("hyperliquid");
    expect(result.tradeTicket.approvalState).toBe("pending");
  });

  it("returns critique output without creating a trade ticket", async () => {
    const result = await runCassie({
      deps: deps("critic"),
      sourcePost,
      userSettings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
      userCommand: "@Cassie tear this apart",
    });

    expect(result.responseType).toBe("critique");
    if (result.responseType !== "critique") {
      throw new Error("Expected critique response.");
    }
    expect(result.critique.strongestObjection).toContain("primary source");
  });
});

describe("risk engine", () => {
  it("rejects a venue the user has not enabled", () => {
    const decision = evaluateRisk({
      marketSelection: {
        ...marketSelection,
        selectedMarket: {
          ...marketSelection.selectedMarket!,
          venue: "deribit",
        },
      },
      userSettings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
    });

    expect(decision).toEqual({
      decision: "reject",
      reason: "Venue is not enabled by the user.",
    });
  });

  it("surfaces missing AI dependency instead of downgrading semantic routing", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await expect(
      new OpenAiStructuredClient().generateObject({
        schema: {} as never,
        name: "test",
        prompt: "test",
      }),
    ).rejects.toBeInstanceOf(MissingAiDependencyError);

    if (originalKey) {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });
});
