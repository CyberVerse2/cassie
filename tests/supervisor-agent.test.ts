import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import type { AccountStateProvider } from "../packages/adapters/hyperliquid/account-state.ts";
import { buildSupervisorInstructions } from "../packages/agent/agent.ts";
import { createCassieSupervisorTools } from "../packages/agent/tools.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type {
  MarketSelection,
  MarketCandidate,
  OpportunityFrame,
  SourcePost,
  TradeExpressionPlan,
  UserSettings,
  XSentimentAssessment,
} from "../packages/core/schemas/index.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "post_1",
  url: null,
  authorHandle: "example",
  authorName: "Example",
  text: "Solana ETF approval is basically inevitable now. Market is asleep.",
  createdAt: null,
  quotedPostText: null,
  linkedUrls: [],
  mediaDescriptions: [],
};

const resolvedSourcePost: SourcePost = {
  platform: "x",
  postId: "2057246023974875269",
  url: "https://x.com/example/status/2057246023974875269",
  authorHandle: "example",
  authorName: "Example",
  text: "OpenAI revenue growth is accelerating ahead of a potential IPO.",
  createdAt: "2026-05-24T00:00:00.000Z",
  quotedPostText: null,
  linkedUrls: ["https://example.com/source"],
  mediaDescriptions: [],
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

const marketSelection: MarketSelection = {
  decision: "select_market",
  selectedMarket: {
    venue: "hyperliquid",
    instrument: "perp",
    side: "long",
    symbol: "SOL",
    conditionId: null,
    outcomeTokenId: null,
    yesOutcomeTokenId: null,
    noOutcomeTokenId: null,
    marketQuestion: null,
    marketSlug: null,
    outcome: null,
    yesPrice: null,
    noPrice: null,
    heldSidePrice: null,
    volumeUsd: null,
    liquidityUsd: null,
    endDate: null,
    warnings: [],
    markPrice: null,
    liquidityScore: 0.9,
    spreadBps: 10,
    estimatedSlippageBps: 10,
    minOrderSizeUsd: 10,
    thesisFit: 0.85,
    reason: "Direct SOL perp expression.",
  },
  selectedCandidateId: "hyperliquid|SOL|long",
  rejectionReason: null,
  rankedCandidates: [],
  rejectedCandidates: [],
  noTradeReason: null,
};

const expressionFitAssessment = {
  candidateId: "hyperliquid:SOL:long",
  expressionId: "expr_crypto_sol",
  expressionRail: "crypto",
  venue: "hyperliquid",
  fitStatus: "validated",
  intendedSide: "long",
  sideFit: "correct",
  directness: "direct",
  fitScore: 0.86,
  semanticFitSummary: "SOL perp is direct exposure to a Solana ETF catalyst.",
  ruleOrContractFitSummary: "The perpetual references SOL and supports the intended long side.",
  basisRisks: ["Perp funding and broad crypto beta can dominate the catalyst."],
  mismatchReasons: [],
  requiredFollowUp: [],
  confidence: 0.84,
};

const opportunityFrame: OpportunityFrame = {
  literalClaim: "Solana ETF approval is basically inevitable now. Market is asleep.",
  opportunity: "The post implies SOL exposure may be underpriced if ETF approval odds are materially higher than the market believes.",
  marketImplication: "Bullish SOL and Solana-linked risk if the claim is believed.",
  userIntent: "trade",
  affectedEntities: ["Solana", "SOL"],
  affectedAssets: ["SOL"],
  expressionFamilies: ["long SOL perp", "buy YES on Solana ETF prediction market", "no trade if already priced"],
  signalVerificationRisk: "medium",
  shouldVerifyTruthBeforeTrading: true,
  reason: "ETF approval claims can move SOL, but the post is social and unverified.",
  confidence: 0.72,
};

const tradeExpression: TradeExpressionPlan = {
  signal: "SOL ETF rumor",
  coreInterpretation: "The clean expression is direct SOL exposure if the catalyst is still underpriced.",
  directAsset: "SOL",
  directAssetTradable: true,
  evidenceConfidence: 0.6,
  marketDiscoveryConfidence: 0.9,
  tradeExpressionConfidence: 0.72,
  highestPurityExpression: "Long SOL perp while the ETF approval catalyst remains unresolved.",
  publicMarketReadThrough: "strong",
  candidates: [
    {
      instrument: "SOL perp",
      venue: "hyperliquid",
      symbol: "SOL",
      instrumentType: "perp",
      venueQuery: "SOL perp",
      expression: "long",
      thesis: "SOL may rally if ETF approval odds are underpriced.",
      venueChecks: ["Hyperliquid SOL perp"],
      currentMarketPriceOrOdds: null,
      fairValueOrExpectedValue: null,
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
  rankedCandidates: [],
  candidateExpressions: [],
  discardedExpressions: [],
  noTradeCase: null,
  decision: "route_to_market_router",
  reason: "The asset is liquid and directly maps to the catalyst.",
  insufficiency: null,
  marketRouterInstructions: "Prefer direct SOL perps over indirect read-throughs.",
};

class FakeAi implements StructuredAiClient {
  readonly calls: string[] = [];

  async generateObject<T>(input: {
    name: string;
    onThinkingTrace?: (thinkingTrace: string | null) => void;
  }): Promise<T> {
    this.calls.push(input.name);
    input.onThinkingTrace?.(`Model reasoning summary for ${input.name}.`);
    const outputs: Record<string, unknown> = {
      cassie_opportunity_frame: opportunityFrame,
      cassie_trade_expressions: tradeExpression,
      cassie_expression_fit: expressionFitAssessment,
      cassie_market_selection: marketSelection,
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

async function seedMarketCandidates(store: InMemoryCassieStore, runId: string, candidates: MarketCandidate[]) {
  await store.addRunStep({
    runId,
    stepType: "market_candidates",
    status: "succeeded",
    input: {},
    output: candidates,
    error: null,
    model: null,
    promptName: null,
    promptVersion: null,
    thinkingTrace: null,
    completedAt: new Date().toISOString(),
  });
}

async function seedFitAssessment(store: InMemoryCassieStore, runId: string, fitAssessment: typeof expressionFitAssessment) {
  await store.addRunStep({
    runId,
    stepType: "market_assessment",
    status: "succeeded",
    input: {},
    output: fitAssessment,
    error: null,
    model: "gpt-5.4-mini",
    promptName: "cassie_expression_fit",
    promptVersion: "2026-05-24",
    thinkingTrace: null,
    completedAt: new Date().toISOString(),
  });
}

async function seedMarketSelection(store: InMemoryCassieStore, runId: string, selection: MarketSelection) {
  await store.addRunStep({
    runId,
    stepType: "market_selection",
    status: "succeeded",
    input: {},
    output: selection,
    error: null,
    model: "gpt-5.4-mini",
    promptName: "cassie_market_selection",
    promptVersion: "2026-05-24",
    thinkingTrace: null,
    completedAt: new Date().toISOString(),
  });
}

async function seedRiskDecision(store: InMemoryCassieStore, runId: string, riskDecision: unknown) {
  await store.addRunStep({
    runId,
    stepType: "risk",
    status: "succeeded",
    input: {},
    output: riskDecision,
    error: null,
    model: null,
    promptName: null,
    promptVersion: null,
    thinkingTrace: null,
    completedAt: new Date().toISOString(),
  });
}

describe("AI SDK supervisor agent", () => {
  it("instructs the supervisor to use a flexible governed loop", () => {
    const instructions = buildSupervisorInstructions();

    expect(instructions).toContain("resolve source -> frame opportunity -> generate candidate trade expressions");
    expect(instructions).toContain("check X sentiment -> rank expressions");
    expect(instructions).toContain("Do not route directly to Polymarket, crypto, or pre-IPO before framing the opportunity");
    expect(instructions).toContain("Use deterministic risk checks only after ranking a real validated candidate");
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
      },
    });

    const risk = await executeTool(tools.risk_check, {
      marketSelection,
      sizeUsd: null,
    });
    const ticket = await executeTool<{ ticketId: string }>(tools.create_trade_ticket, {
      tradeExpression,
      marketSelection,
      riskDecision: risk,
      sizeUsd: null,
    });
    await executeTool(tools.finalize_run, {
      responseType: "trade_ticket",
      publicSummary: "Created a trade ticket for review.",
      tradeTicket: { ticketId: ticket.ticketId },
      riskDecision: risk,
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.approvalState).toBe("pending");
    expect(state.runSteps.map((step) => step.stepType)).toEqual(
      expect.arrayContaining(["risk", "ticket", "final"]),
    );
    expect(state.executionJobs).toHaveLength(0);
  });

  it("uses the selected market thesis when creating a trade ticket", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie trade this",
      sourcePost,
    });
    const selectedMarket: MarketSelection = {
      ...marketSelection,
      selectedMarket: {
        ...marketSelection.selectedMarket!,
        symbol: "BTC",
        side: "short",
        reason: "BTC short on Hyperliquid is the validated proxy for bearish Strategy sale pressure.",
      },
      selectedCandidateId: "hyperliquid:BTC:short",
    };
    const expressionWithHigherPriorityEventMarket: TradeExpressionPlan = {
      ...tradeExpression,
      directAsset: "BTC",
      candidateExpressions: [
        {
          expressionId: "strategy_sale_no",
          expressionRail: "prediction_market",
          expressionType: "event_probability",
          abstractMarket: "Strategy sells Bitcoin this year",
          intendedSide: "no",
          primaryEntityOrEvent: "Strategy Bitcoin sale",
          relatedEntities: ["Strategy"],
          thesis: "Buy No on an exact Strategy-sells-BTC event market.",
          whyThisExpressesTheOpportunity: "The event market would directly resolve the literal claim.",
          directness: "direct",
          whatMustBeTrue: ["An exact event market exists"],
          searchTerms: ["Strategy sells Bitcoin"],
          requiredMarketFeatures: ["Exact event market"],
          requiredRuleOrContractFeatures: ["Rules must resolve on Strategy selling BTC"],
          keyRisks: ["No exact market exists"],
          expectedTimeHorizon: "days",
          priority: "high",
          confidence: 0.8,
        },
      ],
    };

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [selectedMarket.selectedMarket!];
          },
        },
      },
    });

    await executeTool(tools.create_trade_ticket, {
      tradeExpression: expressionWithHigherPriorityEventMarket,
      marketSelection: selectedMarket,
      riskDecision: { decision: "create_ticket_only", reason: "Needs approval." },
      sizeUsd: null,
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.thesis).toBe("BTC short on Hyperliquid is the validated proxy for bearish Strategy sale pressure.");
  });

  it("creates trade tickets from persisted market selection and risk when supervisor omits them", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie trade this",
      sourcePost,
    });
    await seedMarketSelection(store, run.runId, marketSelection);
    await seedRiskDecision(store, run.runId, { decision: "create_ticket_only", reason: "Needs approval." });

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
      },
    });

    const ticketInputSchema = tools.create_trade_ticket.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(ticketInputSchema.safeParse({ tradeExpression }).success).toBe(true);

    await expect(executeTool(tools.create_trade_ticket, {
      tradeExpression,
    })).resolves.toMatchObject({
      instrument: "perp",
      side: "long",
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.instrument).toBe("perp");
    expect(state.tradeTickets[0]?.venueData?.symbol).toBe("SOL");
  });

  it("resolves an explicit X source URL before framing opportunity", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie analyze this https://x.com/example/status/2057246023974875269",
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
            return [];
          },
        },
        sourceResolver: {
          async resolveSource(input) {
            expect(input.url).toBe("https://x.com/example/status/2057246023974875269");
            input.onThinkingTrace?.("Grok returned a source-resolution reasoning summary.");
            return resolvedSourcePost;
          },
        },
      },
    });

    const resolved = await executeTool<SourcePost>(tools.resolve_source, {
      url: "https://x.com/example/status/2057246023974875269",
    });
    await executeTool(tools.frame_opportunity, {
      sourcePost: resolved,
    });

    expect(resolved.text).toContain("OpenAI revenue growth");
    const steps = await store.getRunSteps(run.runId);
    expect(steps.map((step) => step.stepType)).toEqual(
      expect.arrayContaining(["intake", "opportunity"]),
    );
    expect(steps.find((step) => step.stepType === "opportunity")?.input).toMatchObject({
      sourcePost: resolvedSourcePost,
    });
    expect(steps.find((step) => step.stepType === "intake")?.thinkingTrace)
      .toBe("Grok returned a source-resolution reasoning summary.");
    expect(steps.find((step) => step.stepType === "opportunity")?.thinkingTrace)
      .toBe("Model reasoning summary for cassie_opportunity_frame.");
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
      },
      accountStateProvider: new ThrowingAccountStateProvider(),
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
      },
    });

    await expect(executeTool(tools.create_trade_ticket, {
      tradeExpression,
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
      },
    });

    await expect(executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: "No clean trade yet; evidence remains capped.",
      tradeExpression,
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
      },
    });

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

  it("does not reuse cached tool output for different inputs of the same step type", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie quote both",
      sourcePost,
    });
    const firstCandidate = marketSelection.selectedMarket!;
    const secondCandidate: MarketCandidate = {
      ...firstCandidate,
      symbol: "ETH",
      reason: "Second candidate for cache-key coverage.",
    };
    await seedMarketCandidates(store, run.runId, [firstCandidate, secondCandidate]);

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [firstCandidate, secondCandidate];
          },
        },
      },
    });

    await seedFitAssessment(store, run.runId, expressionFitAssessment);
    await seedFitAssessment(store, run.runId, {
      ...expressionFitAssessment,
      candidateId: "hyperliquid:ETH:long",
    });
    const first = await executeTool<MarketCandidate>(tools.quote_expression, {
      candidate: firstCandidate,
      fitAssessment: expressionFitAssessment,
    });
    const second = await executeTool<MarketCandidate>(tools.quote_expression, {
      candidate: secondCandidate,
      fitAssessment: {
        ...expressionFitAssessment,
        candidateId: "hyperliquid:ETH:long",
      },
    });

    expect(first.symbol).toBe("SOL");
    expect(second.symbol).toBe("ETH");
    const steps = await store.getRunSteps(run.runId);
    expect(steps.filter((step) => step.stepType === "market_quote")).toHaveLength(2);
  });

  it("checks X sentiment for validated quoted candidates before ranking", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie check X sentiment",
      sourcePost,
    });
    const sentiment: XSentimentAssessment = {
      status: "available",
      sourcesChecked: ["x"],
      sentimentDirection: "mixed",
      attentionLevel: "high",
      novelty: "already_widespread",
      crowdingRisk: "high",
      correctionRisk: "medium",
      summary: "X attention is high and one-sided, with some credible pushback.",
      evidence: [{
        url: "https://x.com/example/status/1",
        authorName: "Example",
        text: "SOL ETF approval odds are being debated heavily.",
        observedAt: "2026-05-24T00:00:00.000Z",
        relevance: "Shows broad attention and crowding risk.",
      }],
      limitations: ["X search may not see all posts."],
    };

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
        xSentimentProvider: {
          async checkXSentiment(input) {
            expect(input.sourcePost).toBe(sourcePost);
            expect(input.opportunityFrame).toBe(opportunityFrame);
            expect(input.tradeExpression).toBe(tradeExpression);
            expect(input.fitAssessment).toBe(expressionFitAssessment);
            expect(input.candidate).toBe(marketSelection.selectedMarket);
            input.onThinkingTrace?.("Grok summarized X sentiment.");
            return sentiment;
          },
        },
      },
    });

    await expect(executeTool<XSentimentAssessment>(tools.check_x_sentiment, {
      opportunityFrame,
      tradeExpression,
      fitAssessment: expressionFitAssessment,
      candidate: marketSelection.selectedMarket!,
    })).resolves.toMatchObject({
      sentimentDirection: "mixed",
      crowdingRisk: "high",
    });

    const steps = await store.getRunSteps(run.runId);
    expect(steps.find((step) => step.stepType === "x_sentiment")).toMatchObject({
      promptName: "cassie_x_sentiment",
      thinkingTrace: "Grok summarized X sentiment.",
      output: sentiment,
    });
  });

  it("uses AI-backed fit assessment for non-Polymarket candidates instead of auto-validating them", async () => {
    const ai = new FakeAi();
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie check the SOL expression",
      sourcePost,
    });
    await seedMarketCandidates(store, run.runId, [marketSelection.selectedMarket!]);

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
      },
    });

    const rewrittenCandidate = {
      ...marketSelection.selectedMarket!,
      instrument: "Solana narrative",
      markPrice: null,
      warnings: ["model-written candidate"],
    };

    await expect(executeTool(tools.assess_expression_fit, {
      opportunityFrame,
      tradeExpression,
      candidate: rewrittenCandidate,
      side: "no",
    })).resolves.toMatchObject({
      fitStatus: "validated",
      semanticFitSummary: expect.stringContaining("direct exposure"),
    });
    expect(ai.calls).toContain("cassie_expression_fit");
    const steps = await store.getRunSteps(run.runId);
    expect(steps.find((step) => step.stepType === "market_assessment")?.input).toMatchObject({
      candidate: marketSelection.selectedMarket,
    });
    expect(steps.find((step) => step.stepType === "market_assessment")?.input).not.toHaveProperty("side");
  });

  it("hydrates ranking inputs from persisted venue search and quote outputs", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie rank the validated candidate",
      sourcePost,
    });
    const persistedCandidate = marketSelection.selectedMarket!;
    const ai = new FakeAi();
    await seedMarketCandidates(store, run.runId, [persistedCandidate]);
    await seedFitAssessment(store, run.runId, expressionFitAssessment);
    await store.addRunStep({
      runId: run.runId,
      stepType: "market_quote",
      status: "succeeded",
      input: {},
      output: persistedCandidate,
      error: null,
      model: null,
      promptName: null,
      promptVersion: null,
      thinkingTrace: null,
      completedAt: new Date().toISOString(),
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai,
        marketData: {
          async findCandidates() {
            return [];
          },
        },
      },
    });
    const rankInputSchema = tools.rank_expressions.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(rankInputSchema.safeParse({
      tradeExpression,
      fitAssessments: [expressionFitAssessment],
    }).success).toBe(true);
    expect(rankInputSchema.safeParse({
      tradeExpression,
      candidates: tradeExpression.candidates,
      fitAssessments: [expressionFitAssessment],
      quotes: [persistedCandidate],
    }).success).toBe(true);

    await expect(executeTool(tools.rank_expressions, {
      tradeExpression,
      candidates: tradeExpression.candidates,
      fitAssessments: [expressionFitAssessment],
    })).resolves.toMatchObject({
      selectedMarket: persistedCandidate,
      noTradeReason: null,
    });

    const steps = await store.getRunSteps(run.runId);
    expect(steps.find((step) => step.stepType === "market_selection")?.input).toMatchObject({
      candidates: [persistedCandidate],
      quotes: [persistedCandidate],
    });
    expect(ai.calls).toContain("cassie_market_selection");
  });

  it("rejects ranking before every discovered venue candidate has fit and quote coverage", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie rank only after full discovery",
      sourcePost,
    });
    const firstCandidate = marketSelection.selectedMarket!;
    const secondCandidate: MarketCandidate = {
      ...firstCandidate,
      symbol: "ETH",
      reason: "Second discovered candidate.",
    };
    await seedMarketCandidates(store, run.runId, [firstCandidate, secondCandidate]);
    await seedFitAssessment(store, run.runId, expressionFitAssessment);
    await store.addRunStep({
      runId: run.runId,
      stepType: "market_quote",
      status: "succeeded",
      input: {},
      output: firstCandidate,
      error: null,
      model: null,
      promptName: null,
      promptVersion: null,
      thinkingTrace: null,
      completedAt: new Date().toISOString(),
    });

    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [];
          },
        },
      },
    });

    await expect(executeTool(tools.rank_expressions, {
      tradeExpression,
    })).rejects.toThrow("rank_expressions requires fit assessments for every persisted venue candidate.");
  });

});
