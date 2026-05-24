import { describe, expect, it, vi } from "vitest";
import {
  HyperliquidMarketDataProvider,
} from "../packages/adapters/hyperliquid/index.ts";
import {
  PolymarketMarketDataProvider,
} from "../packages/adapters/polymarket/index.ts";
import { ConnectorRequestError, MissingConnectorConfigError } from "../packages/core/helpers/index.ts";
import type { Thesis } from "../packages/core/schemas/index.ts";
import type { HyperliquidCatalogAsset } from "../packages/adapters/hyperliquid/catalog.ts";

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

const staticPolymarketQueryPlanner = {
  async planPolymarketSearchQueries() {
    return ["Solana ETF", "Zcash price"];
  },
};

function catalogAsset(input: {
  symbol: string;
  baseSymbol?: string;
  displayName?: string;
  aliases?: string[];
  dex?: string | null;
  instrumentType?: HyperliquidCatalogAsset["instrumentType"];
  surface?: HyperliquidCatalogAsset["surface"];
}): HyperliquidCatalogAsset {
  const baseSymbol = input.baseSymbol ?? input.symbol.split(":").at(-1) ?? input.symbol;
  return {
    venue: "hyperliquid",
    catalogId: `hyperliquid:${input.dex ?? "perp"}:${baseSymbol}`,
    symbol: input.symbol,
    baseSymbol,
    displayName: input.displayName ?? baseSymbol,
    surface: input.surface ?? (input.dex ? "hip3_perp" : "native_perp"),
    instrumentType: input.instrumentType ?? "perp",
    dex: input.dex ?? null,
    aliases: input.aliases ?? [baseSymbol],
    searchText: [input.symbol, baseSymbol, input.displayName, ...(input.aliases ?? [])].filter(Boolean).join(" "),
    maxLeverage: null,
    onlyIsolated: false,
    marginMode: null,
    source: "hyperliquid_metaAndAssetCtxs",
    raw: { name: input.symbol },
    lastSeenAt: "2026-05-23T00:00:00.000Z",
  };
}

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

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info", [
      catalogAsset({ symbol: "SOL", aliases: ["SOL", "Solana"] }),
    ]).findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("hyperliquid");
    expect(candidates[0]?.symbol).toBe("SOL");
    expect(candidates[0]?.spreadBps).toBeGreaterThan(0);
    fetchMock.mockRestore();
  });

  it("does not return Hyperliquid candidates without a quoted l2 book", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { universe: [{ name: "AI" }] },
            [{ dayNtlVlm: "1000000", markPx: "0.42" }],
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            levels: [[], []],
          }),
        ),
      );

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info", [
      catalogAsset({ symbol: "AI", aliases: ["AI", "Sleepless AI"] }),
    ]).findCandidates({
      thesis: {
        ...thesis,
        claim: "AI may rally after the headline.",
        mentionedAssets: ["AI"],
        topics: ["AI"],
      },
    });

    expect(candidates).toEqual([]);
    fetchMock.mockRestore();
  });

  it("checks Hyperliquid pre-stock aliases for private-company signals", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { type: string; dex?: string; coin?: string };

      if (body.type === "metaAndAssetCtxs" && body.dex === "vntl") {
        return new Response(JSON.stringify([
          { universe: [{ name: "vntl:SPACEX" }, { name: "vntl:OPENAI" }] },
          [{ dayNtlVlm: "7500000", markPx: "74.5" }, { dayNtlVlm: "25000000" }],
        ]));
      }

      if (body.type === "l2Book" && body.coin === "vntl:SPACEX") {
        return new Response(JSON.stringify({
          levels: [
            [{ px: "74.5", sz: "10" }],
            [{ px: "75.5", sz: "10" }],
          ],
        }));
      }

      throw new Error(`Unexpected Hyperliquid request: ${JSON.stringify(body)}`);
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info", [
      catalogAsset({
        symbol: "vntl:SPACEX",
        baseSymbol: "SPACEX",
        displayName: "SpaceX",
        aliases: ["SpaceX", "SPCX", "pre-stock", "private company"],
        dex: "vntl",
        instrumentType: "pre_stock_perp",
        surface: "hip3_perp",
      }),
    ]).findCandidates({
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
        evidenceConfidence: 0.7,
        marketDiscoveryConfidence: 0.2,
        tradeExpressionConfidence: 0.5,
        highestPurityExpression: "Hyperliquid SpaceX pre-stock perp if available.",
        publicMarketReadThrough: "weak",
        candidates: [],
        rankedCandidates: [],
        decision: "route_to_market_router",
        reason: "Direct pre-stock venue data determines actionability.",
        insufficiency: null,
        marketRouterInstructions: "Check SPCX/SpaceX pre-stock perps before rejecting tradability.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venue: "hyperliquid",
      instrument: "pre_stock_perp",
      side: "short",
      symbol: "vntl:SPACEX",
    });
    fetchMock.mockRestore();
  });

  it("uses the Hyperliquid catalog to discover HIP-3 deployer markets", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { type: string; dex?: string; coin?: string };

      if (body.type === "metaAndAssetCtxs" && body.dex === "vntl") {
        return new Response(JSON.stringify([
          {
            universe: [
              {
                name: "vntl:ANTHROPIC",
                maxLeverage: 3,
                onlyIsolated: true,
                marginMode: "strictIsolated",
              },
            ],
          },
          [{ dayNtlVlm: "71177.6532", markPx: "1381.2", midPx: "1401.95" }],
        ]));
      }

      if (body.type === "l2Book" && body.coin === "vntl:ANTHROPIC") {
        return new Response(JSON.stringify({
          levels: [
            [{ px: "1390", sz: "1" }],
            [{ px: "1410", sz: "1" }],
          ],
        }));
      }

      throw new Error(`Unexpected Hyperliquid request: ${JSON.stringify(body)}`);
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info", [
      catalogAsset({
        symbol: "vntl:ANTHROPIC",
        baseSymbol: "ANTHROPIC",
        displayName: "Anthropic",
        aliases: ["Anthropic", "Claude", "ANTHROPIC"],
        dex: "vntl",
        instrumentType: "pre_stock_perp",
        surface: "hip3_perp",
      }),
    ]).findCandidates({
      thesis: {
        claim: "Anthropic valuation looks too rich after the latest private-market mark.",
        direction: "bearish",
        mentionedAssets: ["Anthropic"],
        topics: ["Anthropic", "Claude", "private AI company"],
        timeHorizon: "event_based",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.72,
      },
      tradeExpression: {
        signal: "Anthropic private-market valuation",
        coreInterpretation: "Check direct Anthropic pre-stock price discovery before using broad AI proxies.",
        directAsset: "Anthropic",
        directAssetTradable: false,
        evidenceConfidence: 0.72,
        marketDiscoveryConfidence: 0.2,
        tradeExpressionConfidence: 0.5,
        highestPurityExpression: "Short Anthropic pre-stock perp if available.",
        publicMarketReadThrough: "weak",
        candidates: [],
        rankedCandidates: [],
        decision: "needs_market_check",
        reason: "Needs direct venue availability.",
        insufficiency: null,
        marketRouterInstructions: "Check Hyperliquid HIP-3 pre-stock markets for Anthropic or Claude.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venue: "hyperliquid",
      instrument: "pre_stock_perp",
      side: "short",
      symbol: "vntl:ANTHROPIC",
      markPrice: 1381.2,
    });
    fetchMock.mockRestore();
  });

  it("checks Hyperliquid quoted asset symbols for crypto thesis assets", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { universe: [{ name: "ZEC-USDC" }, { name: "ZEC/USDC" }] },
            [{ dayNtlVlm: "230936177" }, { dayNtlVlm: "7006750" }],
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            levels: [
              [{ px: "642.9", sz: "100" }],
              [{ px: "643.1", sz: "100" }],
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            levels: [
              [{ px: "643.2", sz: "100" }],
              [{ px: "643.4", sz: "100" }],
            ],
          }),
        ),
      );

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info", [
      catalogAsset({ symbol: "ZEC-USDC", baseSymbol: "ZEC", aliases: ["ZEC", "Zcash"] }),
      catalogAsset({ symbol: "ZEC/USDC", baseSymbol: "ZEC", aliases: ["ZEC", "Zcash"] }),
    ]).findCandidates({
      thesis: {
        claim: "ZEC price targets relative to BTC: conservative 3-5%, aggressive 15-20%.",
        direction: "bullish",
        mentionedAssets: ["ZEC"],
        topics: ["Zcash", "relative value"],
        timeHorizon: "event_based",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.7,
      },
      tradeExpression: {
        signal: "ZEC to reach 3-5% of BTC market cap",
        coreInterpretation: "Check direct ZEC venue liquidity instead of requiring a literal ZEC/BTC venue.",
        directAsset: "ZEC",
        directAssetTradable: true,
        evidenceConfidence: 0.7,
        marketDiscoveryConfidence: 0.5,
        tradeExpressionConfidence: 0.7,
        highestPurityExpression: "Long ZEC with BTC as the benchmark.",
        publicMarketReadThrough: "none",
        candidates: [
          {
            instrument: "ZEC/BTC Pair",
            expression: "pair",
            thesis: "ZEC should rerate relative to BTC.",
            causalDirectness: 0.9,
            liquidity: 0.5,
            surprise: 0.5,
            timing: 0.5,
            crowdingRisk: 0.5,
            downsideAsymmetry: 0.5,
            evidenceQuality: 0.5,
            expectedEdge: 0.2,
            tradableNow: true,
            rejectionReason: null,
            invalidation: [],
            evidenceNeeded: [],
            currentMarketPriceOrOdds: null,
            fairValueOrExpectedValue: null,
            instrumentType: "perp",
            symbol: "ZEC/BTC",
            venue: "hyperliquid",
            venueChecks: ["ZEC perp on Hyperliquid"],
            venueQuery: "ZEC perp",
          },
        ],
        rankedCandidates: [],
        decision: "needs_market_check",
        reason: "Needs venue liquidity check.",
        insufficiency: null,
        marketRouterInstructions: "Check Hyperliquid for direct ZEC perps or spot markets.",
      },
    });

    expect(candidates.map((candidate) => candidate.symbol)).toEqual(["ZEC-USDC", "ZEC/USDC"]);
    fetchMock.mockRestore();
  });

  it("maps Polymarket markets into prediction-market candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname === "/book") {
        return new Response(
          JSON.stringify({
            bids: [{ price: "0.61", size: "100" }],
            asks: [{ price: "0.63", size: "100" }],
          }),
        );
      }

      return new Response(JSON.stringify(url.searchParams.get("search") === "Solana ETF"
        ? [
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
        ]
        : []));
    });

    const candidates = await new PolymarketMarketDataProvider("https://example.test/markets", "https://clob.polymarket.com", staticPolymarketQueryPlanner).findCandidates({
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

  it("requires an AI query planner for Polymarket semantic discovery", async () => {
    await expect(new PolymarketMarketDataProvider("https://example.test/markets").findCandidates({
      thesis,
    })).rejects.toBeInstanceOf(MissingConnectorConfigError);
  });

  it("searches Polymarket with reusable asset and event queries instead of pair-expression blobs", async () => {
    const searches: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname === "/book") {
        return new Response(
          JSON.stringify({
            bids: [{ price: "0.53", size: "100" }],
            asks: [{ price: "0.55", size: "100" }],
          }),
        );
      }

      const search = url.searchParams.get("search") ?? "";
      searches.push(search);

      return new Response(JSON.stringify(search === "Zcash price"
        ? [
          {
            id: "asset-price-event",
            slug: "what-price-will-zcash-hit-before-2027",
            question: "What price will Zcash hit before 2027?",
            active: true,
            closed: false,
            liquidityNum: 700000,
            clobTokenIds: JSON.stringify(["yes_token", "no_token"]),
            outcomePrices: JSON.stringify(["0.54", "0.46"]),
            conditionId: "condition_asset_price",
          },
        ]
        : []));
    });

    const candidates = await new PolymarketMarketDataProvider("https://example.test/markets", "https://example.test", staticPolymarketQueryPlanner).findCandidates({
      thesis: {
        claim: "ZEC price targets relative to BTC: conservative 3-5%, aggressive 15-20%, moonshot flippening.",
        direction: "bullish",
        mentionedAssets: ["ZEC"],
        topics: ["Zcash", "relative value"],
        timeHorizon: "event_based",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.7,
      },
      tradeExpression: {
        signal: "ZEC to reach 3-5% of BTC market cap",
        coreInterpretation: "Search for direct asset prediction markets rather than a literal pair venue.",
        directAsset: "ZEC",
        directAssetTradable: true,
        evidenceConfidence: 0.7,
        marketDiscoveryConfidence: 0.5,
        tradeExpressionConfidence: 0.7,
        highestPurityExpression: "Long ZEC relative to BTC.",
        publicMarketReadThrough: "none",
        candidates: [
          {
            instrument: "ZEC/BTC Pair",
            expression: "pair",
            thesis: "ZEC should rerate relative to BTC.",
            causalDirectness: 0.9,
            liquidity: 0.5,
            surprise: 0.5,
            timing: 0.5,
            crowdingRisk: 0.5,
            downsideAsymmetry: 0.5,
            evidenceQuality: 0.5,
            expectedEdge: 0.2,
            tradableNow: true,
            rejectionReason: null,
            invalidation: [],
            evidenceNeeded: [],
            currentMarketPriceOrOdds: null,
            fairValueOrExpectedValue: null,
            instrumentType: "prediction_market",
            symbol: "ZEC/BTC",
            venue: "polymarket",
            venueChecks: ["Zcash price markets"],
            venueQuery: "Zcash prediction market",
          },
        ],
        rankedCandidates: [],
        decision: "needs_market_check",
        reason: "Needs prediction market check.",
        insufficiency: null,
        marketRouterInstructions: "Find direct asset price prediction markets.",
      },
    });

    expect(searches).toContain("Zcash price");
    expect(searches.some((search) => search.includes("ZEC/BTC Pair"))).toBe(false);
    expect(candidates[0]?.instrument).toBe("what-price-will-zcash-hit-before-2027");
    fetchMock.mockRestore();
  });

  it("surfaces Polymarket order book failures instead of dropping the venue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname === "/book") {
        return new Response("upstream unavailable", { status: 503 });
      }

      return new Response(JSON.stringify(url.searchParams.get("search") === "Solana ETF"
        ? [
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
        ]
        : []));
    });

    await expect(new PolymarketMarketDataProvider("https://example.test/markets", "https://clob.polymarket.com", staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toBeInstanceOf(ConnectorRequestError);
    fetchMock.mockRestore();
  });

  it("rejects Polymarket markets without condition IDs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname === "/book") {
        return new Response(
          JSON.stringify({
            bids: [{ price: "0.53", size: "100" }],
            asks: [{ price: "0.55", size: "100" }],
          }),
        );
      }

      return new Response(JSON.stringify(url.searchParams.get("search") === "Solana ETF"
        ? [
          {
            id: "1",
            slug: "solana-etf-approved",
            question: "Will a Solana ETF be approved?",
            active: true,
            closed: false,
            liquidityNum: 600000,
            clobTokenIds: JSON.stringify(["123", "456"]),
            outcomePrices: JSON.stringify(["0.62", "0.38"]),
          },
        ]
        : []));
    });

    await expect(new PolymarketMarketDataProvider("https://example.test/markets", "https://clob.polymarket.com", staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toThrow("condition_id");
    fetchMock.mockRestore();
  });

  it("rejects malformed Polymarket token ID arrays with provider-field context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      return new Response(JSON.stringify(url.searchParams.get("search") === "Solana ETF"
        ? [
          {
            id: "1",
            slug: "solana-etf-approved",
            question: "Will a Solana ETF be approved?",
            active: true,
            closed: false,
            liquidityNum: 600000,
            clobTokenIds: "[\"123\",",
            outcomePrices: JSON.stringify(["0.62", "0.38"]),
            conditionId: "condition_1",
          },
        ]
        : []));
    });

    await expect(new PolymarketMarketDataProvider("https://example.test/markets", "https://clob.polymarket.com", staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field clobTokenIds for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects malformed Polymarket outcome price arrays with provider-field context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      return new Response(JSON.stringify(url.searchParams.get("search") === "Solana ETF"
        ? [
          {
            id: "1",
            slug: "solana-etf-approved",
            question: "Will a Solana ETF be approved?",
            active: true,
            closed: false,
            liquidityNum: 600000,
            clobTokenIds: JSON.stringify(["123", "456"]),
            outcomePrices: "[\"0.62\",",
            conditionId: "condition_1",
          },
        ]
        : []));
    });

    await expect(new PolymarketMarketDataProvider("https://example.test/markets", "https://clob.polymarket.com", staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field outcomePrices for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects parsed Polymarket arrays containing non-string values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      return new Response(JSON.stringify(url.searchParams.get("search") === "Solana ETF"
        ? [
          {
            id: "1",
            slug: "solana-etf-approved",
            question: "Will a Solana ETF be approved?",
            active: true,
            closed: false,
            liquidityNum: 600000,
            clobTokenIds: ["123", 456],
            outcomePrices: JSON.stringify(["0.62", "0.38"]),
            conditionId: "condition_1",
          },
        ]
        : []));
    });

    await expect(new PolymarketMarketDataProvider("https://example.test/markets", "https://clob.polymarket.com", staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field clobTokenIds for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("normalizes Polymarket NO-side quotes to held-side prices", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname === "/book") {
        return new Response(
          JSON.stringify({
            bids: [{ price: "0.63", size: "100" }],
            asks: [{ price: "0.65", size: "100" }],
          }),
        );
      }

      return new Response(JSON.stringify(url.searchParams.get("search") === "Solana ETF"
        ? [
          {
            id: "1",
            slug: "solana-etf-approved",
            question: "Will a Solana ETF be approved?",
            active: true,
            closed: false,
            liquidityNum: 9000,
            volumeNum: 12000,
            clobTokenIds: JSON.stringify(["yes-token", "no-token"]),
            outcomePrices: JSON.stringify(["0.37", "0.63"]),
            conditionId: "condition_1",
            endDate: "2026-09-01T00:00:00Z",
          },
        ]
        : []));
    });

    const candidates = await new PolymarketMarketDataProvider("https://example.test/markets", "https://example.test", staticPolymarketQueryPlanner).findPolymarketMarkets({
      thesis: {
        ...thesis,
        direction: "bearish",
      },
    });

    expect(candidates[0]).toMatchObject({
      side: "buy_no",
      outcome: "no",
      conditionId: "condition_1",
      outcomeTokenId: "no-token",
      yesPrice: 0.37,
      noPrice: 0.63,
      heldSidePrice: 0.64,
      marketQuestion: "Will a Solana ETF be approved?",
      marketSlug: "solana-etf-approved",
      endDate: "2026-09-01T00:00:00Z",
      warnings: ["liquidity_under_10000"],
    });
    fetchMock.mockRestore();
  });
});
