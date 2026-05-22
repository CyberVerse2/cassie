import { describe, expect, it, vi } from "vitest";
import {
  formatResearchConnectorError,
  GeminiWebSearchLane,
  GrokXSearchLane,
  SearchQueryOutputSchema,
} from "../packages/research/lanes.ts";
import {
  HyperliquidMarketDataProvider,
  PolymarketMarketDataProvider,
} from "../packages/market-data/index.ts";
import { ConnectorRequestError, MissingConnectorConfigError } from "../packages/core/connector-errors.ts";
import type { ResearchQueryPlan, Thesis } from "../packages/core/schemas/index.ts";

const thesis: Thesis = {
  claim: "SOL may rally because Solana ETF approval odds are increasing.",
  direction: "bullish",
  mentionedAssets: ["SOL"],
  topics: ["Solana ETF"],
  timeHorizon: "event_based",
  evidenceQuality: "weak",
  manipulationRisk: "medium",
  confidence: 0.8,
};

const queryPlan: ResearchQueryPlan = {
  version: "research-query-plan/v1",
  normalizedClaim: thesis.claim,
  signalType: "rumor",
  mode: "standard",
  assets: thesis.mentionedAssets,
  topics: thesis.topics,
  sourceHandle: "example",
  sourceName: "Example",
  scores: {
    specificity: 0.8,
    marketLinkage: 0.8,
    sourceValue: 0.5,
    urgency: 0.4,
    risk: 0.5,
    novelty: 0.5,
    expectedValueOfResearch: 0.7,
  },
  goals: [
    {
      id: "verify_event",
      kind: "event_validation",
      question: "Verify whether the claimed catalyst is real.",
      decisionUse: "validate_or_kill_thesis",
      priority: 0.9,
      mustResolve: true,
      lanes: ["web", "x"],
      evidenceNeeds: ["Primary or credible secondary source for Solana ETF approval odds."],
      disconfirmingQuestions: ["Is the rumor refuted or stale?"],
      resolutionCriteria: {
        supportedIf: "Credible current evidence confirms the catalyst.",
        contradictedIf: "Primary sources refute or invalidate the catalyst.",
        unresolvedIf: "Only social repetition is available.",
      },
      budget: { maxQueries: 2, maxResults: 20, wave: 0 },
      stopWhen: ["claim is refuted"],
    },
  ],
  queryBatches: [
    {
      wave: 0,
      name: "Catalyst verification",
      purpose: "Verify the Solana ETF catalyst.",
      queries: [
        {
          id: "q_verify_web",
          goalIds: ["verify_event"],
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
          goalIds: ["verify_event"],
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
    requiredGoalIds: ["verify_event"],
    cannotConcludeIfUnresolved: ["verify_event"],
  },
};

describe("research connectors", () => {
  it("requires Gemini configuration for web search", async () => {
    await expect(new GeminiWebSearchLane(undefined).runQueryJob({} as never, queryPlan)).rejects.toBeInstanceOf(
      MissingConnectorConfigError,
    );
  });

  it("requires xAI configuration for X search", async () => {
    await expect(new GrokXSearchLane(undefined).runQueryJob({} as never, queryPlan)).rejects.toBeInstanceOf(
      MissingConnectorConfigError,
    );
  });

  it("preserves upstream provider error details for live timelines", () => {
    const error = Object.assign(new Error("Provider returned error"), {
      statusCode: 500,
      data: {
        error: {
          message: "schema compiler failed",
          provider_name: "ExampleProvider",
        },
      },
      responseBody: "{\"error\":{\"message\":\"raw upstream failure\"}}",
      cause: new Error("No output generated."),
    });

    expect(formatResearchConnectorError(error)).toContain("Provider returned error");
    expect(formatResearchConnectorError(error)).toContain("status=500");
    expect(formatResearchConnectorError(error)).toContain("schema compiler failed");
    expect(formatResearchConnectorError(error)).toContain("raw upstream failure");
    expect(formatResearchConnectorError(error)).toContain("No output generated.");
  });

  it("uses a compact structured output contract for each search query", () => {
    expect(SearchQueryOutputSchema.parse({
      findings: [
        {
          claim: "A regulator filing mentions the relevant ETF.",
          sourceUrls: ["https://example.com/source"],
          relevance: 0.9,
          stance: "supports",
          sourceType: "regulatory",
          directness: "primary",
          reliability: "high",
          quote: null,
        },
      ],
      sources: [
        {
          title: "Example source",
          url: "https://example.com/source",
          sourceName: "Example",
          sourceType: "regulatory",
          publishedAt: null,
          snippet: "A source-backed snippet.",
        },
      ],
      unresolved: ["Whether the approval odds changed today."],
    })).toMatchObject({
      findings: [{ reliability: "high", stance: "supports" }],
      sources: [{ sourceName: "Example" }],
    });
  });

  it("normalizes common directness labels from structured search models", () => {
    expect(SearchQueryOutputSchema.parse({
      findings: [
        {
          claim: "SOL/ETH ratio context is sourced from market data.",
          sourceUrls: ["https://example.com/source"],
          relevance: 0.9,
          stance: "context",
          sourceType: "market_data",
          directness: "direct",
          reliability: "medium",
          quote: "Market data shows the ratio.",
        },
        {
          claim: "The filing is from an official source.",
          sourceUrls: ["https://example.com/filing"],
          relevance: 1,
          stance: "supports",
          sourceType: "regulatory",
          directness: "primary source",
          reliability: "high",
          quote: null,
        },
      ],
      sources: [
        {
          title: "Example source",
          url: "https://example.com/source",
          sourceName: "Example",
          sourceType: "market_data",
          publishedAt: null,
          snippet: "A source-backed snippet.",
        },
      ],
      unresolved: [],
    }).findings.map((finding) => finding.directness)).toEqual(["primary", "primary"]);
  });

  it("defaults omitted directness to conservative context", () => {
    const parsed = SearchQueryOutputSchema.parse({
      findings: [
        {
          claim: "The origin post exists and contains the quoted ZEC target.",
          sourceUrls: ["https://x.com/QwQiao/status/2057429323607314794"],
          relevance: 1,
          stance: "supports",
          sourceType: "social",
          reliability: "high",
          quote: "a conservative target for zec is to reach ~3-5% of btc",
        },
      ],
      sources: [
        {
          title: "Origin post",
          url: "https://x.com/QwQiao/status/2057429323607314794",
          sourceName: "X",
          sourceType: "social",
          publishedAt: null,
          snippet: "a conservative target for zec...",
        },
      ],
      unresolved: [],
    });

    expect(parsed.findings[0]?.directness).toBe("context");
  });

  it("rejects overlarge structured source lists", () => {
    expect(SearchQueryOutputSchema.safeParse({
      findings: [],
      sources: [
        {
          title: "Source 1",
          url: "https://example.com/1",
          sourceName: "Example",
          sourceType: "news",
          publishedAt: null,
          snippet: null,
        },
        {
          title: "Source 2",
          url: "https://example.com/2",
          sourceName: "Example",
          sourceType: "news",
          publishedAt: null,
          snippet: null,
        },
        {
          title: "Source 3",
          url: "https://example.com/3",
          sourceName: "Example",
          sourceType: "news",
          publishedAt: null,
          snippet: null,
        },
      ],
      unresolved: [],
    }).success).toBe(false);
  });
});

describe("market data connectors", () => {
  it("maps Hyperliquid asset contexts into market candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { universe: [{ name: "SOL" }, { name: "BTC" }] },
            [{ dayNtlVlm: "100000000" }, { dayNtlVlm: "1000000000" }],
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            levels: [
              [{ px: "99.9", sz: "100" }],
              [{ px: "100.1", sz: "100" }],
            ],
          }),
        ),
      );

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("hyperliquid");
    expect(candidates[0]?.symbol).toBe("SOL");
    expect(candidates[0]?.spreadBps).toBeGreaterThan(0);
    fetchMock.mockRestore();
  });

  it("checks Hyperliquid pre-stock aliases for private-company signals", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { universe: [{ name: "SPCX" }, { name: "COIN" }] },
            [{ dayNtlVlm: "7500000" }, { dayNtlVlm: "25000000" }],
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            levels: [
              [{ px: "74.5", sz: "10" }],
              [{ px: "75.5", sz: "10" }],
            ],
          }),
        ),
      );

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis: {
        claim: "SpaceX IPO valuation may be too rich for a clean public trade.",
        direction: "bearish",
        mentionedAssets: ["SpaceX"],
        topics: ["SpaceX IPO", "pre-stock"],
        timeHorizon: "event_based",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.7,
      },
      tradeExpression: {
        signal: "SpaceX pre-IPO valuation",
        coreInterpretation: "Check direct pre-stock price discovery before dead-ending.",
        directAsset: "SpaceX",
        directAssetTradable: false,
        highestPurityExpression: "Hyperliquid SpaceX pre-stock perp if available.",
        publicMarketReadThrough: "weak",
        candidates: [],
        decision: "route_to_market_router",
        reason: "Direct pre-stock venue data determines actionability.",
        marketRouterInstructions: "Check SPCX/SpaceX pre-stock perps before rejecting tradability.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venue: "hyperliquid",
      instrument: "pre_stock_perp",
      side: "short",
      symbol: "SPCX",
    });
    fetchMock.mockRestore();
  });

  it("maps Polymarket markets into prediction-market candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "1",
              slug: "solana-etf-approved",
              question: "Will a Solana ETF be approved?",
              active: true,
              closed: false,
              liquidityNum: 600000,
              clobTokenIds: JSON.stringify(["123", "456"]),
              outcomePrices: JSON.stringify(["0.62", "0.38"]),
              conditionId: "condition_1",
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bids: [{ price: "0.61", size: "100" }],
            asks: [{ price: "0.63", size: "100" }],
          }),
        ),
      );

    const candidates = await new PolymarketMarketDataProvider("https://example.test/markets").findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("polymarket");
    expect(candidates[0]?.side).toBe("buy_yes");
    expect(candidates[0]?.instrument).toBe("solana-etf-approved");
    expect(candidates[0]?.outcomeTokenId).toBe("123");
    expect(candidates[0]?.conditionId).toBe("condition_1");
    fetchMock.mockRestore();
  });

  it("surfaces Polymarket order book failures instead of dropping the venue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "1",
              slug: "solana-etf-approved",
              question: "Will a Solana ETF be approved?",
              active: true,
              closed: false,
              liquidityNum: 600000,
              clobTokenIds: JSON.stringify(["123", "456"]),
              outcomePrices: JSON.stringify(["0.62", "0.38"]),
              conditionId: "condition_1",
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }));

    await expect(new PolymarketMarketDataProvider("https://example.test/markets").findCandidates({
      thesis,
    })).rejects.toBeInstanceOf(ConnectorRequestError);
    fetchMock.mockRestore();
  });
});
