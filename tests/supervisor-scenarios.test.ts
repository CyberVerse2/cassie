import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { createCassieSupervisorTools, finalizeRunFromPersistedSteps } from "../packages/agent/supervisor/tools.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type {
  Critique,
  IntentResult,
  InverseThesis,
  MarketSelection,
  RiskDecision,
  SignalInterpretation,
  SourcePost,
  Thesis,
  TradeExpressionPlan,
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

const inverseThesis: InverseThesis = {
  originalThesis: thesis,
  inverseClaim: "SOL may sell off because ETF approval is unconfirmed and crowded.",
  inverseDirection: "bearish",
  mentionedAssets: ["SOL"],
  topics: ["Solana ETF"],
  timeHorizon: "event_based",
  confidence: 0.7,
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
      cassie_trade_expression_step: {
        action: "finish_trade_expression",
        reason: "Fixture completes the trade-expression loop.",
        final: tradeExpression,
      },
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
    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const result = await executeTool<Critique>(tools.critique_thesis, {
      thesis: extracted,
    });
    await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
    });
    await executeTool(tools.finalize_run, {
      responseType: "critique",
      publicSummary: result.finalCritique,
      critique: result,
    });

    const state = await store.load();
    expect(state.tradeTickets).toHaveLength(0);
    expect(state.researchReports).toHaveLength(0);
    await expect(store.getRun(run.runId)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("finalizes critic requests without requiring the model to copy critique JSON", async () => {
    const { store, run, tools } = await createScenario("critic");
    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const result = await executeTool<Critique>(tools.critique_thesis, {
      thesis: extracted,
    });
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
    });
    await executeTool(tools.finalize_run, {
      responseType: "critique",
      publicSummary: result.finalCritique,
      critique: result,
      tradeExpression: expression,
    });

    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      status: "succeeded",
      result: {
        responseType: "critique",
        publicSummary: expect.stringContaining(result.finalCritique),
        runStatus: "succeeded",
        ticketId: null,
      },
    });
    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      result: {
        actionState: "route_to_market",
        publicSummary: expect.stringContaining("Next step: route the cleanest candidate to market selection"),
      },
    });
  });

  it("handles countertrade requests through inverse thesis before ticket creation", async () => {
    const { store, tools } = await createScenario("countertrade");
    const intent = await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const inverse = await executeTool<InverseThesis>(tools.extract_inverse_thesis, { intent, thesis: extracted });
    const counterThesis = {
      ...extracted,
      claim: inverse.inverseClaim,
      direction: inverse.inverseDirection,
      mentionedAssets: inverse.mentionedAssets,
      topics: inverse.topics,
      timeHorizon: inverse.timeHorizon,
      confidence: inverse.confidence,
    } satisfies Thesis;
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: counterThesis,
    });
    const selected = await executeTool<MarketSelection>(tools.select_market, {
      thesis: counterThesis,
      tradeExpression: expression,
    });
    const risk = await executeTool<RiskDecision>(tools.risk_check, {
      marketSelection: selected,
      sizeUsd: null,
    });
    const ticket = await executeTool<{ ticketId: string }>(tools.create_trade_ticket, {
      intent,
      thesis: counterThesis,
      marketSelection: selected,
      riskDecision: risk,
      sizeUsd: null,
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.ticketId).toBe(ticket.ticketId);
    expect(state.runSteps.map((step) => step.stepType)).toEqual(
      expect.arrayContaining(["inverse_thesis", "trade_expression", "market_selection", "risk", "ticket"]),
    );
    expect(state.runSteps.map((step) => step.stepType)).not.toContain("research");
  });

  it("finalizes rejected-risk trade requests without creating a ticket", async () => {
    const { store, run, tools } = await createScenario("trade", {
      ...baseSettings,
      maxSpreadBps: 1,
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
    const risk = await executeTool<RiskDecision>(tools.risk_check, {
      marketSelection: selected,
      sizeUsd: null,
    });

    expect(risk.decision).toBe("reject");
    await executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: risk.decision === "reject" ? risk.reason : "Risk check passed.",
      intent,
      thesis: extracted,
      tradeExpression: expression,
      marketSelection: selected,
      riskDecision: risk,
    });

    const state = await store.load();
    expect(state.tradeTickets).toHaveLength(0);
    await expect(store.getRun(run.runId)).resolves.toMatchObject({ status: "succeeded" });
    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      result: {
        actionState: "block_trade",
        publicSummary: expect.stringContaining("Spread is wider than user limit"),
      },
    });
  });

  it("finalizes no-trade market routing without preserving stale route language", async () => {
    const { store, run, tools } = await createScenario("critic");
    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const expression = await executeTool<TradeExpressionPlan>(tools.plan_trade_expression, {
      signal: interpreted,
      thesis: extracted,
    });
    const noTradeMarketSelection: MarketSelection = {
      selectedMarket: null,
      rejectedCandidates: [],
      noTradeReason: "No configured venue candidate matched the trade expression.",
    };
    await store.addRunStep({
      runId: run.runId,
      stepType: "market_selection",
      status: "succeeded",
      input: null,
      output: noTradeMarketSelection,
      error: null,
      model: "deepseek/deepseek-v4-flash",
      promptName: "cassie_market_selection",
      promptVersion: "test",
      completedAt: new Date().toISOString(),
    });

    await executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: "Model wanted to route.",
      thesis: extracted,
      tradeExpression: expression,
      marketSelection: noTradeMarketSelection,
    });

    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      result: {
        actionState: "no_trade",
        publicSummary: expect.stringContaining("Market check came back no-trade"),
      },
    });
    const completed = await store.getRun(run.runId);
    expect(String(completed?.result)).not.toContain("route_to_market_router");
  });

  it("maps non-watch unresolved expressions to insufficient evidence", async () => {
    const { store, run, tools } = await createScenario("critic");
    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const unresolvedExpression: TradeExpressionPlan = {
      ...tradeExpression,
      decision: "needs_market_check",
      reason: "Evidence is too weak to route.",
      evidenceConfidence: 0.54,
      marketDiscoveryConfidence: 0.32,
      tradeExpressionConfidence: 0.32,
      insufficiency: {
        score: 0.32,
        requiredThreshold: 0.65,
        failedDimensions: ["market_discovery", "price_or_odds"],
        summary: "No venue-confirmed market or current price was available.",
        evidenceNeededToClear: ["Confirmed Hyperliquid or Polymarket market", "Live price or odds"],
      },
      marketRouterInstructions: null,
    };
    await store.addRunStep({
      runId: run.runId,
      stepType: "trade_expression",
      status: "succeeded",
      input: null,
      output: unresolvedExpression,
      error: null,
      model: "deepseek-v4-pro",
      promptName: "cassie_trade_expression",
      promptVersion: "test",
      completedAt: new Date().toISOString(),
    });

    await executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: "Evidence is too weak.",
      thesis: extracted,
      tradeExpression: unresolvedExpression,
    });

    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      result: {
        actionState: "insufficient_evidence",
        publicSummary: expect.stringContaining("Evidence is still below Cassie's bar"),
      },
    });
    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      result: {
        publicSummary: expect.stringContaining("market discovery, price or odds"),
      },
    });
    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      result: {
        publicSummary: expect.not.stringContaining("Model-copied no-trade"),
      },
    });
  });

  it("finalizes from persisted canonical steps when the agent loop does not call finalize_run", async () => {
    const { store, run, tools } = await createScenario("trade");
    await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    await store.addRunStep({
      runId: run.runId,
      stepType: "trade_expression",
      status: "succeeded",
      input: null,
      output: {
        ...tradeExpression,
        decision: "needs_market_check",
        tradeExpressionConfidence: 0.32,
        insufficiency: {
          score: 0.32,
          requiredThreshold: 0.65,
          failedDimensions: ["market_discovery"],
          summary: "No venue-confirmed market.",
          evidenceNeededToClear: ["Venue market confirmation"],
        },
        reason: "Wait for the catalyst to resolve before routing.",
        marketRouterInstructions: null,
      },
      error: null,
      model: "deepseek-v4-pro",
      promptName: "cassie_trade_expression",
      promptVersion: "test",
      completedAt: new Date().toISOString(),
    });

    const final = await finalizeRunFromPersistedSteps({ store, run });

    expect(final).toMatchObject({
      actionState: "insufficient_evidence",
      responseType: "analysis",
      publicSummary: expect.stringContaining("Next step: check the matching venue or market"),
    });
    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      status: "succeeded",
      result: {
        actionState: "insufficient_evidence",
      },
    });
    expect(extracted.claim).toBeTruthy();
  });

  it("keeps watchlist action state reserved for explicit watch requests", async () => {
    const { store, run, tools } = await createScenario("watch");
    const intent = await executeTool<IntentResult>(tools.classify_intent, {});
    const interpreted = await executeTool<SignalInterpretation>(tools.interpret_signal, {});
    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal: interpreted });
    const watchExpression: TradeExpressionPlan = {
      ...tradeExpression,
      decision: "needs_market_check",
      reason: "User explicitly asked Cassie to watch this setup.",
      marketRouterInstructions: null,
    };
    await store.addRunStep({
      runId: run.runId,
      stepType: "trade_expression",
      status: "succeeded",
      input: null,
      output: watchExpression,
      error: null,
      model: "deepseek-v4-pro",
      promptName: "cassie_trade_expression",
      promptVersion: "test",
      completedAt: new Date().toISOString(),
    });

    await executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: "Explicit watch request.",
      intent,
      thesis: extracted,
      tradeExpression: watchExpression,
    });

    await expect(store.getRun(run.runId)).resolves.toMatchObject({
      result: {
        actionState: "watchlist",
        publicSummary: expect.stringContaining("Next step: check the matching venue or market"),
      },
    });
  });
});
