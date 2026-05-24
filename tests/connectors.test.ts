import { describe, expect, it, vi } from "vitest";
import {
  HyperliquidMarketDataProvider,
} from "../packages/adapters/hyperliquid/index.ts";
import {
  PolymarketMarketDataProvider,
  PolymarketSdkSearchClient,
} from "../packages/adapters/polymarket/index.ts";
import { ConnectorRequestError, MissingConnectorConfigError } from "../packages/core/helpers/index.ts";
import type { Thesis } from "../packages/core/schemas/index.ts";

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

const staticPolymarketSearchClient = {
  async searchMarkets(query: string) {
    if (query !== "Solana ETF") return [];
    return [
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
    ];
  },
  async fetchOrderBook() {
    return {
      bids: [{ price: "0.61", size: "100" }],
      asks: [{ price: "0.63", size: "100" }],
    };
  },
  async fetchBuyPrice() {
    return 0.63;
  },
  async fetchSpread() {
    return 0.02;
  },
};

function polymarketSearchClientFor(markets: any[], book = {
  bids: [{ price: "0.53", size: "100" }],
  asks: [{ price: "0.55", size: "100" }],
}) {
  return {
    async searchMarkets() {
      return markets;
    },
    async fetchOrderBook() {
      return book;
    },
    async fetchBuyPrice() {
      return Number(book.asks[0]?.price ?? 0) || null;
    },
    async fetchSpread() {
      const bid = Number(book.bids[0]?.price ?? 0);
      const ask = Number(book.asks[0]?.price ?? 0);
      return bid > 0 && ask > 0 ? ask - bid : null;
    },
  };
}

function hyperliquidInfoFetchMock(input: {
  dexes?: Array<null | { name: string }>;
  metas: Record<string, {
    universe: Array<{ name: string; maxLeverage?: number; onlyIsolated?: boolean; marginMode?: string }>;
    ctxs: Array<{ dayNtlVlm?: string; markPx?: string; midPx?: string; funding?: string }>;
  }>;
  books: Record<string, { levels: [Array<{ px: string; sz: string }>, Array<{ px: string; sz: string }>] }>;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { type: string; dex?: string; coin?: string };

    if (body.type === "perpDexs") {
      return new Response(JSON.stringify(input.dexes ?? [null]));
    }

    if (body.type === "metaAndAssetCtxs") {
      const key = body.dex ?? "main";
      const meta = input.metas[key];
      if (!meta) throw new Error(`Unexpected Hyperliquid metadata request: ${JSON.stringify(body)}`);
      return new Response(JSON.stringify([{ universe: meta.universe }, meta.ctxs]));
    }

    if (body.type === "l2Book" && body.coin) {
      const book = input.books[body.coin];
      if (!book) throw new Error(`Unexpected Hyperliquid book request: ${JSON.stringify(body)}`);
      return new Response(JSON.stringify(book));
    }

    throw new Error(`Unexpected Hyperliquid request: ${JSON.stringify(body)}`);
  });
}

describe("market data connectors", () => {
  it("maps Hyperliquid asset contexts into market candidates", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      metas: {
        main: {
          universe: [{ name: "SOL" }, { name: "BTC" }],
          ctxs: [{ dayNtlVlm: "100000000" }, { dayNtlVlm: "1000000000" }],
        },
      },
      books: {
        SOL: {
          levels: [
            [{ px: "99.9", sz: "100" }],
            [{ px: "100.1", sz: "100" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("hyperliquid");
    expect(candidates[0]?.symbol).toBe("SOL");
    expect(candidates[0]?.spreadBps).toBeGreaterThan(0);
    fetchMock.mockRestore();
  });

  it("does not return Hyperliquid candidates without a quoted l2 book", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      metas: {
        main: {
          universe: [{ name: "AI" }],
          ctxs: [{ dayNtlVlm: "1000000", markPx: "0.42" }],
        },
      },
      books: {
        AI: { levels: [[], []] },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
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

  it("does not default unclear Hyperliquid thesis direction to long", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      metas: {
        main: {
          universe: [{ name: "BTC" }],
          ctxs: [{ dayNtlVlm: "100000000", markPx: "76728" }],
        },
      },
      books: {
        BTC: {
          levels: [
            [{ px: "76727", sz: "1" }],
            [{ px: "76729", sz: "1" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis: {
        ...thesis,
        claim: "BTC may move, but direction is unclear.",
        direction: "unclear",
        mentionedAssets: ["BTC"],
        topics: ["Bitcoin"],
      },
    });

    expect(candidates).toEqual([]);
    fetchMock.mockRestore();
  });

  it("uses live Hyperliquid dex discovery for private-company signals", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      dexes: [null, { name: "vntl" }],
      metas: {
        main: { universe: [], ctxs: [] },
        vntl: {
          universe: [{ name: "vntl:SPACEX" }, { name: "vntl:OPENAI" }],
          ctxs: [{ dayNtlVlm: "7500000", markPx: "74.5" }, { dayNtlVlm: "25000000" }],
        },
      },
      books: {
        "vntl:SPACEX": {
          levels: [
            [{ px: "74.5", sz: "10" }],
            [{ px: "75.5", sz: "10" }],
          ],
        },
      },
    });

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
        evidenceConfidence: 0.7,
        marketDiscoveryConfidence: 0.2,
        tradeExpressionConfidence: 0.5,
        highestPurityExpression: "Hyperliquid SpaceX pre-stock perp if available.",
        publicMarketReadThrough: "weak",
        candidates: [],
        rankedCandidates: [],
        candidateExpressions: [
          {
            expressionId: "spacex_preipo",
            expressionRail: "pre_ipo",
            expressionType: "directional",
            abstractMarket: "SpaceX pre-stock perp",
            intendedSide: "short",
            primaryEntityOrEvent: "SpaceX",
            relatedEntities: ["SpaceX"],
            thesis: "Short SpaceX private-market valuation.",
            whyThisExpressesTheOpportunity: "A SpaceX pre-stock perp directly tracks the private-company valuation thesis.",
            directness: "direct",
            whatMustBeTrue: ["SpaceX pre-stock market exists"],
            searchTerms: ["SpaceX pre-stock perp"],
            requiredMarketFeatures: ["tradable perp"],
            requiredRuleOrContractFeatures: ["instrument tracks SpaceX valuation"],
            keyRisks: ["basis risk"],
            expectedTimeHorizon: "days",
            priority: "high",
            confidence: 0.5,
          },
        ],
        discardedExpressions: [],
        noTradeCase: null,
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

  it("discovers HIP-3 deployer markets from live Hyperliquid dex metadata", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      dexes: [null, { name: "vntl" }],
      metas: {
        main: { universe: [], ctxs: [] },
        vntl: {
          universe: [
            {
              name: "vntl:ANTHROPIC",
              maxLeverage: 3,
              onlyIsolated: true,
              marginMode: "strictIsolated",
            },
          ],
          ctxs: [{ dayNtlVlm: "71177.6532", markPx: "1381.2", midPx: "1401.95" }],
        },
      },
      books: {
        "vntl:ANTHROPIC": {
          levels: [
            [{ px: "1390", sz: "1" }],
            [{ px: "1410", sz: "1" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
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
        candidateExpressions: [
          {
            expressionId: "anthropic_preipo",
            expressionRail: "pre_ipo",
            expressionType: "directional",
            abstractMarket: "Anthropic pre-stock perp",
            intendedSide: "short",
            primaryEntityOrEvent: "Anthropic",
            relatedEntities: ["Anthropic"],
            thesis: "Short Anthropic private-market valuation.",
            whyThisExpressesTheOpportunity: "An Anthropic pre-stock perp directly tracks the private-company valuation thesis.",
            directness: "direct",
            whatMustBeTrue: ["Anthropic pre-stock market exists"],
            searchTerms: ["Anthropic pre-stock perp"],
            requiredMarketFeatures: ["tradable perp"],
            requiredRuleOrContractFeatures: ["instrument tracks Anthropic valuation"],
            keyRisks: ["basis risk"],
            expectedTimeHorizon: "days",
            priority: "high",
            confidence: 0.5,
          },
        ],
        discardedExpressions: [],
        noTradeCase: null,
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
    const fetchMock = hyperliquidInfoFetchMock({
      metas: {
        main: {
          universe: [{ name: "ZEC-USDC" }, { name: "ZEC/USDC" }],
          ctxs: [{ dayNtlVlm: "230936177" }, { dayNtlVlm: "7006750" }],
        },
      },
      books: {
        "ZEC-USDC": {
          levels: [
            [{ px: "642.9", sz: "100" }],
            [{ px: "643.1", sz: "100" }],
          ],
        },
        "ZEC/USDC": {
          levels: [
            [{ px: "643.2", sz: "100" }],
            [{ px: "643.4", sz: "100" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
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
        candidateExpressions: [],
        discardedExpressions: [],
        noTradeCase: null,
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

      return new Response("unexpected discovery fetch", { status: 500 });
    });

    const candidates = await new PolymarketMarketDataProvider(staticPolymarketSearchClient, staticPolymarketQueryPlanner).findCandidates({
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
    await expect(new PolymarketMarketDataProvider().findCandidates({
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

      return new Response("unexpected discovery fetch", { status: 500 });
    });
    const searchClient = {
      async searchMarkets(query: string) {
        searches.push(query);
        if (query !== "Zcash price") return [];
        return [
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
        ];
      },
      async fetchOrderBook() {
        return {
          bids: [{ price: "0.53", size: "100" }],
          asks: [{ price: "0.55", size: "100" }],
        };
      },
      async fetchBuyPrice() {
        return 0.55;
      },
      async fetchSpread() {
        return 0.02;
      },
    };

    const candidates = await new PolymarketMarketDataProvider(searchClient, staticPolymarketQueryPlanner).findCandidates({
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
        candidateExpressions: [],
        discardedExpressions: [],
        noTradeCase: null,
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

  it("searches Polymarket through the beta SDK public search surface", async () => {
    const requests: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.toString());

      expect(url.pathname).toBe("/public-search");
      expect(url.searchParams.get("q")).toBe("ethereum researchers");
      expect(url.searchParams.get("events_status")).toBe("active");
      expect(url.searchParams.get("optimized")).toBe("false");
      expect(url.searchParams.get("limit_per_type")).toBe("7");
      expect(url.searchParams.get("search")).toBeNull();

      return new Response(JSON.stringify({
        events: [
          {
            id: "event_1",
            slug: "ethereum-price-event",
            title: "Ethereum price event",
            state: { active: true, closed: false },
            markets: [
              {
                id: "market_1",
                slug: "will-ethereum-researchers-resign",
                question: "Will Ethereum researchers resign?",
                conditionId: "0x1111111111111111111111111111111111111111111111111111111111111111",
                active: true,
                closed: false,
                endDate: "2026-06-01T00:00:00Z",
                outcomes: ["Yes", "No"],
                outcomePrices: ["0.42", "0.58"],
                clobTokenIds: ["yes_token", "no_token"],
                marketMakerAddress: "0x0000000000000000000000000000000000000000",
                liquidityNum: "12000",
                volumeNum: "50000",
              },
            ],
          },
        ],
        tags: [],
        profiles: [],
        pagination: { hasMore: false, totalResults: 1 },
      }));
    });

    const markets = await new PolymarketSdkSearchClient().searchMarkets("ethereum researchers", 7);

    expect(requests).toHaveLength(1);
    expect(markets[0]?.slug).toBe("will-ethereum-researchers-resign");
    expect(markets[0]?.clobTokenIds).toBe(JSON.stringify(["yes_token", "no_token"]));
    fetchMock.mockRestore();
  });

  it("surfaces Polymarket order book failures instead of dropping the venue", async () => {
    const searchClient = {
      ...staticPolymarketSearchClient,
      async fetchOrderBook() {
        throw new ConnectorRequestError("Polymarket order book", 503, "upstream unavailable");
      },
    };

    await expect(new PolymarketMarketDataProvider(searchClient, staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toBeInstanceOf(ConnectorRequestError);
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

      return new Response("unexpected discovery fetch", { status: 500 });
    });

    await expect(new PolymarketMarketDataProvider(polymarketSearchClientFor([
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
    ]), staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toThrow("condition_id");
    fetchMock.mockRestore();
  });

  it("rejects malformed Polymarket token ID arrays with provider-field context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      return new Response("unexpected discovery fetch", { status: 500 });
    });

    await expect(new PolymarketMarketDataProvider(polymarketSearchClientFor([
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
    ]), staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field clobTokenIds for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects malformed Polymarket outcome price arrays with provider-field context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      return new Response("unexpected discovery fetch", { status: 500 });
    });

    await expect(new PolymarketMarketDataProvider(polymarketSearchClientFor([
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
    ]), staticPolymarketQueryPlanner).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field outcomePrices for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects parsed Polymarket arrays containing non-string values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      return new Response("unexpected discovery fetch", { status: 500 });
    });

    await expect(new PolymarketMarketDataProvider(polymarketSearchClientFor([
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
    ]), staticPolymarketQueryPlanner).findCandidates({
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

      return new Response("unexpected discovery fetch", { status: 500 });
    });

    const candidates = await new PolymarketMarketDataProvider(polymarketSearchClientFor([
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
    ], {
      bids: [{ price: "0.63", size: "100" }],
      asks: [{ price: "0.65", size: "100" }],
    }), staticPolymarketQueryPlanner).findPolymarketMarkets({
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
