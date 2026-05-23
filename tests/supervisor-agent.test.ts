import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import type { AccountStateProvider } from "../packages/execution/account-state.ts";
import { buildSupervisorInstructions } from "../packages/agent/supervisor/agent.ts";
import { createCassieSupervisorTools } from "../packages/agent/supervisor/tools.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type {
  IntentResult,
  MarketSelection,
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
  reason: "The asset is liquid and directly maps to the catalyst.",
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
      cassie_trade_expression_step: {
        action: "finish_trade_expression",
        reason: "Fixture completes the trade-expression loop.",
        final: tradeExpression,
      },
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
    expect(instructions).toContain("Once you have made the grounded decision for this run, call finalize_run next");
    expect(instructions).toContain("Mode policy:");
    expect(instructions).toContain("trade:");
    expect(instructions).toContain("critic:");
    expect(instructions).toContain("countertrade:");
    expect(instructions).toContain("watch:");
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
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
    });
    const selected = await executeTool<MarketSelection>(tools.select_market, {
      thesis: extracted,
      tradeExpression: expression,
    });
    const risk = await executeTool(tools.risk_check, {
      marketSelection: selected,
      sizeUsd: intent.userSizeOverrideUsd,
    });
    const ticket = await executeTool<{ ticketId: string }>(tools.create_trade_ticket, {
      intent,
      thesis: extracted,
      marketSelection: selected,
      riskDecision: risk,
      sizeUsd: intent.userSizeOverrideUsd,
    });
    await executeTool(tools.finalize_run, {
      responseType: "trade_ticket",
      publicSummary: "Created a trade ticket for review.",
      tradeTicket: { ticketId: ticket.ticketId },
      riskDecision: risk,
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.approvalState).toBe("pending");
    expect(state.researchReports).toHaveLength(0);
    expect(state.runSteps.map((step) => step.stepType)).toEqual(
      expect.arrayContaining(["intent", "signal", "thesis", "trade_expression", "market_selection", "risk", "ticket", "final"]),
    );
    expect(state.runSteps.map((step) => step.stepType)).not.toContain("research");
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
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
    });
    await executeTool(tools.select_market, {
      thesis: extracted,
      tradeExpression: expression,
    });
    await expect(executeTool(tools.risk_check, {
      marketSelection,
      sizeUsd: null,
    })).rejects.toThrow("account state unavailable");
  });

  it("runs risk checks from the supplied market selection", async () => {
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
    })).resolves.toMatchObject({
      decision: "require_approval",
      reason: "Auto-trade is disabled.",
    });
  });

  it("rejects trade ticket creation without a supplied non-rejected risk decision", async () => {
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

    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
    });
    await executeTool(tools.select_market, {
      thesis: extracted,
      tradeExpression: expression,
    });
    await expect(executeTool(tools.create_trade_ticket, {
      intent: { intent: "trade", urgency: "normal", userSizeOverrideUsd: null },
      thesis: extracted,
      marketSelection,
      sizeUsd: null,
    })).rejects.toThrow("Trade ticket creation requires a non-rejected risk decision.");
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

    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
    });

    await expect(executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: "No clean trade yet; evidence remains capped.",
      thesis: extracted,
      tradeExpression: expression,
    })).resolves.toMatchObject({
      responseType: "analysis",
      publicSummary: expect.stringContaining("asset is liquid"),
    });
  });

  it("finalizes a supplied trade ticket without requiring a persisted ticket lookup", async () => {
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

    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });

    await expect(executeTool(tools.finalize_run, {
      responseType: "trade_ticket",
      publicSummary: "Created a ticket.",
      tradeTicket: { ticketId: "missing_ticket" },
      riskDecision: { decision: "approve", adjustedSizeUsd: 50 },
    })).resolves.toMatchObject({
      responseType: "trade_ticket",
      ticketId: "missing_ticket",
    });
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

  it("uses important AI for critique and trade expression, but cheap AI for market selection", async () => {
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

    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    await executeTool(tools.critique_thesis, {
      thesis,
    });
    await executeTool(tools.plan_trade_expression, {
      signal: interpreted,
      thesis,
    });
    await executeTool(tools.select_market, {
      thesis,
      tradeExpression,
    });

    expect(importantAi.calls).toEqual([
      "cassie_critique",
      "cassie_trade_expression_step",
    ]);
    expect(cheapAi.calls).toEqual(["cassie_signal", "cassie_thesis", "cassie_market_selection"]);
    const steps = await store.getRunSteps(run.runId);
    expect(steps.map((step) => ({ type: step.stepType, model: step.model }))).toEqual([
      { type: "signal", model: "deepseek-v4-flash" },
      { type: "thesis", model: "deepseek-v4-flash" },
      { type: "critique", model: "deepseek-v4-pro" },
      { type: "trade_expression", model: "deepseek-v4-pro" },
      { type: "market_selection", model: "deepseek-v4-flash" },
    ]);
  });

  it("uses supplied tool inputs instead of persisted canonical lookups", async () => {
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

    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    await executeTool(tools.critique_thesis, {
      thesis: { ...thesis, claim: "Lossy copied thesis." },
    });
    await executeTool(tools.plan_trade_expression, {
      signal: interpreted,
      thesis,
    });

    const steps = await store.getRunSteps(run.runId);
    expect(steps.find((step) => step.stepType === "critique")?.input).toMatchObject({
      thesis: { ...thesis, claim: "Lossy copied thesis." },
    });
    expect(steps.find((step) => step.stepType === "trade_expression")?.input).toMatchObject({
      thesis,
    });
  });
});
