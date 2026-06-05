import { describe, expect, it, vi } from "vitest";
import {
  HyperliquidMarketDataProvider,
} from "../packages/adapters/index.ts";
import {
  PolymarketMarketDataProvider,
  type PolymarketSearchClient,
  PolymarketSdkSearchClient,
} from "../packages/adapters/index.ts";
import { ConnectorRequestError, MissingConnectorConfigError } from "../packages/core/helpers/connector-errors.ts";
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

const staticPolymarketSearchResultSelector = {
  async selectPolymarketSearchResults(input: { markets: Array<{ slug: string }>; limit?: number }) {
    return input.markets.map((market) => market.slug).slice(0, input.limit ?? 10);
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
        description: "This market resolves Yes if a Solana ETF is approved by the deadline.",
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

type PolymarketSearchMarket = Awaited<ReturnType<PolymarketSearchClient["searchMarkets"]>>[number];

function polymarketSearchClientFor(markets: PolymarketSearchMarket[], book = {
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
    collateralToken?: number;
    universe: Array<{ name: string; maxLeverage?: number; onlyIsolated?: boolean; marginMode?: string }>;
    ctxs: Array<{ dayNtlVlm?: string; markPx?: string; midPx?: string; funding?: string }>;
  }>;
  spotMeta?: {
    universe: Array<{ name: string; tokens: number[]; index: number; isCanonical: boolean }>;
    tokens: Array<{ name: string; fullName: string | null; szDecimals: number; index: number; isCanonical: boolean }>;
    ctxs: Array<{ coin?: string; dayNtlVlm?: string; markPx?: string; midPx?: string }>;
  };
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
      return new Response(JSON.stringify([{ universe: meta.universe, collateralToken: meta.collateralToken }, meta.ctxs]));
    }

    if (body.type === "spotMetaAndAssetCtxs") {
      return new Response(JSON.stringify([
        {
          universe: input.spotMeta?.universe ?? [],
          tokens: input.spotMeta?.tokens ?? [],
        },
        input.spotMeta?.ctxs ?? [],
      ]));
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
    expect(fetchMock.mock.calls.some(([, init]) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
      return body.type === "l2Book";
    })).toBe(false);
    fetchMock.mockRestore();
  });

  it("uses matching direct expression side when top expression is a prediction market", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      metas: {
        main: {
          universe: [{ name: "BTC" }],
          ctxs: [{ dayNtlVlm: "1000000000", markPx: "76728" }],
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
        claim: "Strategy may sell Bitcoin this year.",
        direction: "unclear",
        mentionedAssets: ["BTC", "Strategy"],
        topics: ["Strategy Bitcoin sale"],
      },
      tradeExpression: {
        signal: "bearish",
        coreInterpretation: "The exact event is Strategy selling BTC, with BTC short as the direct venue proxy.",
        directAsset: "BTC",
        directAssetTradable: true,
        evidenceConfidence: 0.79,
        marketDiscoveryConfidence: 0.58,
        tradeExpressionConfidence: 0.72,
        highestPurityExpression: "Buy Yes on an exact Strategy BTC-sale event market.",
        publicMarketReadThrough: "moderate",
        candidates: [],
        rankedCandidates: [],
        candidateExpressions: [
          {
            expressionId: "strategy_sale_event",
            expressionRail: "prediction_market",
            expressionType: "event_probability",
            abstractMarket: "Strategy BTC sale before year-end 2026",
            intendedSide: "yes",
            primaryEntityOrEvent: "Strategy sells Bitcoin before 2026-12-31",
            relatedEntities: ["Strategy", "Bitcoin"],
            thesis: "Strategy sells BTC before year-end.",
            whyThisExpressesTheOpportunity: "It directly isolates the binary catalyst.",
            directness: "direct",
            whatMustBeTrue: ["A matching event market exists."],
            searchTerms: ["Strategy sells Bitcoin before 2026-12-31"],
            requiredMarketFeatures: ["binary yes/no"],
            requiredRuleOrContractFeatures: ["defines BTC sale"],
            keyRisks: [],
            expectedTimeHorizon: "months",
            priority: "high",
            confidence: 0.89,
          },
          {
            expressionId: "btc_short",
            expressionRail: "crypto",
            expressionType: "directional",
            abstractMarket: "BTC perp or spot",
            intendedSide: "short",
            primaryEntityOrEvent: "Bitcoin",
            relatedEntities: ["Strategy"],
            thesis: "A perceived Strategy BTC sale can pressure Bitcoin.",
            whyThisExpressesTheOpportunity: "BTC is the liquid direct read-through.",
            directness: "strong_proxy",
            whatMustBeTrue: ["BTC is listed and liquid."],
            searchTerms: ["BTC perp Hyperliquid", "BTC spot Hyperliquid"],
            requiredMarketFeatures: ["live BTC market"],
            requiredRuleOrContractFeatures: ["standard spot/perp specs"],
            keyRisks: [],
            expectedTimeHorizon: "days",
            priority: "medium",
            confidence: 0.74,
          },
        ],
        discardedExpressions: [],
        noTradeCase: null,
        decision: "needs_market_check",
        reason: "Needs venue discovery.",
        insufficiency: null,
        marketRouterInstructions: "Search exact event first, then BTC short.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venue: "hyperliquid",
      instrument: "perp",
      side: "short",
      symbol: "BTC",
    });
    fetchMock.mockRestore();
  });

  it("uses live Hyperliquid dex discovery for private-company signals", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      dexes: [null, { name: "xyz" }, { name: "vntl" }],
      metas: {
        main: { universe: [], ctxs: [] },
        xyz: {
          collateralToken: 0,
          universe: [{ name: "xyz:SPCX" }],
          ctxs: [{ dayNtlVlm: "37039160", markPx: "165.28" }],
        },
        vntl: {
          collateralToken: 360,
          universe: [{ name: "vntl:SPACEX" }, { name: "vntl:OPENAI" }],
          ctxs: [{ dayNtlVlm: "7500000", markPx: "74.5" }, { dayNtlVlm: "25000000" }],
        },
      },
      books: {
        "xyz:SPCX": {
          levels: [
            [{ px: "165.0", sz: "10" }],
            [{ px: "165.2", sz: "10" }],
          ],
        },
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
      symbol: "xyz:SPCX",
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

  it("uses broad configured-venue rails as Hyperliquid symbol anchors", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      metas: {
        main: {
          universe: [{ name: "NVDA" }],
          ctxs: [{ dayNtlVlm: "18000000", markPx: "156.4" }],
        },
      },
      books: {
        NVDA: {
          levels: [
            [{ px: "156.3", sz: "100" }],
            [{ px: "156.5", sz: "100" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis: {
        claim: "Nvidia earnings could re-rate AI capex exposure.",
        direction: "bullish",
        mentionedAssets: ["AI"],
        topics: ["AI capex", "Nvidia"],
        timeHorizon: "days",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.7,
      },
      tradeExpression: {
        signal: "Nvidia AI capex acceleration",
        coreInterpretation: "Search configured venues for direct Nvidia exposure before rejecting public-equity tradability.",
        directAsset: "Nvidia",
        directAssetTradable: false,
        evidenceConfidence: 0.7,
        marketDiscoveryConfidence: 0.2,
        tradeExpressionConfidence: 0.54,
        highestPurityExpression: "Long NVDA if a configured venue lists it.",
        publicMarketReadThrough: "strong",
        candidates: [],
        rankedCandidates: [],
        candidateExpressions: [{
          expressionId: "nvda_public_equity",
          expressionRail: "public_equity",
          expressionType: "directional",
          abstractMarket: "NVDA listed equity or synthetic",
          intendedSide: "long",
          primaryEntityOrEvent: "NVDA",
          relatedEntities: ["Nvidia"],
          thesis: "Long Nvidia if a configured venue provides direct exposure.",
          whyThisExpressesTheOpportunity: "NVDA is the direct public-market read-through.",
          directness: "direct",
          whatMustBeTrue: ["A configured venue lists NVDA exposure."],
          searchTerms: ["NVDA"],
          requiredMarketFeatures: ["direct NVDA exposure"],
          requiredRuleOrContractFeatures: ["tracks NVDA"],
          keyRisks: ["No configured listing exists."],
          expectedTimeHorizon: "days",
          priority: "high",
          confidence: 0.54,
        }],
        discardedExpressions: [],
        noTradeCase: null,
        decision: "needs_market_check",
        reason: "Venue discovery determines actionability.",
        insufficiency: null,
        marketRouterInstructions: "Search Hyperliquid for direct NVDA exposure.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venue: "hyperliquid",
      instrument: "perp",
      side: "long",
      symbol: "NVDA",
    });
    fetchMock.mockRestore();
  });

  it("extracts exact Hyperliquid symbols from routed equity expression phrases", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      dexes: [{ name: "xyz" }],
      metas: {
        main: {
          universe: [],
          ctxs: [],
        },
        xyz: {
          universe: [{ name: "xyz:NVDA" }],
          ctxs: [{ dayNtlVlm: "18000000", markPx: "216.1" }],
        },
      },
      books: {
        "xyz:NVDA": {
          levels: [
            [{ px: "216.0", sz: "100" }],
            [{ px: "216.2", sz: "100" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis: {
        claim: "Nvidia and Microsoft benefit from local AI PC adoption.",
        direction: "bullish",
        mentionedAssets: ["NVDA", "MSFT"],
        topics: ["AI PC"],
        timeHorizon: "days",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.82,
      },
      tradeExpression: {
        signal: "bullish",
        coreInterpretation: "Bullish read-through for NVDA and MSFT.",
        directAsset: "NVDA",
        directAssetTradable: false,
        evidenceConfidence: 0.82,
        marketDiscoveryConfidence: 0.31,
        tradeExpressionConfidence: 0.77,
        highestPurityExpression: "long NVDA",
        publicMarketReadThrough: "strong",
        candidates: [],
        rankedCandidates: [],
        candidateExpressions: [{
          expressionId: "nvda_public_equity_long",
          expressionRail: "public_equity",
          expressionType: "directional",
          abstractMarket: "NVDA common stock",
          intendedSide: "long",
          primaryEntityOrEvent: "Nvidia",
          relatedEntities: ["Microsoft"],
          thesis: "AI-PC messaging is bullish for Nvidia.",
          whyThisExpressesTheOpportunity: "Nvidia is the direct public-equity expression.",
          directness: "direct",
          whatMustBeTrue: ["A configured venue lists NVDA exposure."],
          searchTerms: ["NVDA synthetic", "NVDA perp", "Nvidia Hyperliquid"],
          requiredMarketFeatures: ["direct NVDA exposure"],
          requiredRuleOrContractFeatures: ["tracks NVDA"],
          keyRisks: ["No configured listing exists."],
          expectedTimeHorizon: "days",
          priority: "high",
          confidence: 0.9,
        }],
        discardedExpressions: [],
        noTradeCase: null,
        decision: "needs_market_check",
        reason: "Venue discovery determines actionability.",
        insufficiency: null,
        marketRouterInstructions: "Search Hyperliquid live metadata for NVDA synthetic listings.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venue: "hyperliquid",
      instrument: "synthetic_perp",
      side: "long",
      symbol: "xyz:NVDA",
    });
    fetchMock.mockRestore();
  });

  it("searches Hyperliquid spot metadata with trade-expression aliases", async () => {
    const spotCtxs = Array.from({ length: 183 }, (_, index) =>
      index === 182
        ? { coin: "@182", dayNtlVlm: "99206.127", markPx: "4507.6", midPx: "4507.75" }
        : {}
    );
    const fetchMock = hyperliquidInfoFetchMock({
      metas: {
        main: {
          universe: [{ name: "BTC" }],
          ctxs: [{ dayNtlVlm: "100000000" }],
        },
      },
      spotMeta: {
        tokens: [
          { name: "USDC", fullName: null, szDecimals: 8, index: 0, isCanonical: true },
          { name: "XAUT0", fullName: "XAUT0", szDecimals: 2, index: 297, isCanonical: false },
        ],
        universe: [
          { name: "@182", tokens: [297, 0], index: 182, isCanonical: false },
        ],
        ctxs: spotCtxs,
      },
      books: {
        "@182": {
          levels: [
            [{ px: "4507.0", sz: "1" }],
            [{ px: "4508.5", sz: "1" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis: {
        claim: "Tokenized gold should rally.",
        direction: "bullish",
        mentionedAssets: ["gold"],
        topics: ["tokenized gold"],
        timeHorizon: "days",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.72,
      },
      tradeExpression: {
        signal: "Gold breakout",
        coreInterpretation: "Use direct tokenized gold exposure where available.",
        directAsset: "gold",
        directAssetTradable: true,
        evidenceConfidence: 0.7,
        marketDiscoveryConfidence: 0.7,
        tradeExpressionConfidence: 0.72,
        highestPurityExpression: "Buy tokenized gold spot if liquid.",
        publicMarketReadThrough: "none",
        candidates: [],
        rankedCandidates: [],
        candidateExpressions: [
          {
            expressionId: "expr_gold_spot",
            expressionRail: "commodity",
            expressionType: "directional",
            abstractMarket: "Tokenized gold spot",
            intendedSide: "long",
            primaryEntityOrEvent: "gold",
            relatedEntities: ["XAUT", "PAXG"],
            thesis: "Tokenized gold should rally.",
            whyThisExpressesTheOpportunity: "XAUT is direct tokenized gold exposure.",
            directness: "direct",
            whatMustBeTrue: ["A live XAUT spot market exists."],
            searchTerms: ["XAUT", "tokenized gold"],
            requiredMarketFeatures: ["spot"],
            requiredRuleOrContractFeatures: [],
            keyRisks: [],
            expectedTimeHorizon: "days",
            priority: "high",
            confidence: 0.72,
          },
        ],
        discardedExpressions: [],
        noTradeCase: null,
        decision: "needs_market_check",
        reason: "Needs venue check.",
        insufficiency: null,
        marketRouterInstructions: "Search Hyperliquid spot for XAUT or PAXG.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venue: "hyperliquid",
      instrument: "spot",
      side: "buy",
      symbol: "XAUT0/USDC",
      markPrice: 4507.6,
    });
    expect(candidates[0]?.minOrderSizeUsd).toBeCloseTo(45.0775);
    fetchMock.mockRestore();
  });

  it("does not return hedge or reference assets for direct Hyperliquid searches", async () => {
    const fetchMock = hyperliquidInfoFetchMock({
      dexes: [null, { name: "hyna" }],
      metas: {
        main: {
          universe: [{ name: "BTC" }, { name: "ZEC" }],
          ctxs: [{ dayNtlVlm: "100000000" }, { dayNtlVlm: "50000000" }],
        },
        hyna: {
          universe: [{ name: "hyna:BTC" }, { name: "hyna:ZEC" }],
          ctxs: [{ dayNtlVlm: "2000000" }, { dayNtlVlm: "1200000" }],
        },
      },
      books: {
        ZEC: {
          levels: [
            [{ px: "632.4", sz: "100" }],
            [{ px: "632.6", sz: "100" }],
          ],
        },
        "hyna:ZEC": {
          levels: [
            [{ px: "632.5", sz: "100" }],
            [{ px: "632.7", sz: "100" }],
          ],
        },
      },
    });

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis: {
        claim: "ZEC should outperform BTC.",
        direction: "bullish",
        mentionedAssets: ["ZEC", "BTC"],
        topics: ["relative value"],
        timeHorizon: "days",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.74,
      },
      tradeExpression: {
        signal: "ZEC relative value versus BTC",
        coreInterpretation: "The direct leg is long ZEC; BTC is only a hedge/reference asset until multi-leg tickets exist.",
        directAsset: "ZEC",
        directAssetTradable: true,
        evidenceConfidence: 0.7,
        marketDiscoveryConfidence: 0.7,
        tradeExpressionConfidence: 0.74,
        highestPurityExpression: "Long ZEC against BTC if supported.",
        publicMarketReadThrough: "moderate",
        candidates: [
          {
            instrument: "BTC hedge",
            expression: "short",
            thesis: "BTC is the hedge leg.",
            causalDirectness: 0.4,
            liquidity: 0.9,
            surprise: 0.2,
            timing: 0.6,
            crowdingRisk: 0.4,
            downsideAsymmetry: 0.4,
            evidenceQuality: 0.4,
            expectedEdge: 0.1,
            tradableNow: false,
            rejectionReason: "Hedge leg only.",
            invalidation: [],
            evidenceNeeded: [],
            currentMarketPriceOrOdds: null,
            fairValueOrExpectedValue: null,
            instrumentType: "perp",
            symbol: "BTC",
            venue: "hyperliquid",
            venueChecks: ["BTC perp"],
            venueQuery: "BTC perp",
          },
        ],
        rankedCandidates: [],
        candidateExpressions: [
          {
            expressionId: "zec_direct",
            expressionRail: "crypto",
            expressionType: "directional",
            abstractMarket: "ZEC perp",
            intendedSide: "long",
            primaryEntityOrEvent: "ZEC",
            relatedEntities: ["BTC"],
            thesis: "Long ZEC captures the direct narrative.",
            whyThisExpressesTheOpportunity: "ZEC is the asset expected to re-rate.",
            directness: "direct",
            whatMustBeTrue: ["ZEC is listed"],
            searchTerms: ["ZEC perp", "BTC hedge"],
            requiredMarketFeatures: ["live ZEC perp"],
            requiredRuleOrContractFeatures: ["tracks ZEC"],
            keyRisks: ["BTC hedge mechanics unsupported"],
            expectedTimeHorizon: "days",
            priority: "high",
            confidence: 0.74,
          },
        ],
        discardedExpressions: [],
        noTradeCase: null,
        decision: "needs_market_check",
        reason: "Needs live ZEC venue confirmation.",
        insufficiency: null,
        marketRouterInstructions: "Search direct ZEC only.",
      },
    });

    expect(candidates.map((candidate) => candidate.symbol)).toEqual(["ZEC", "hyna:ZEC"]);
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

    const candidates = await new PolymarketMarketDataProvider(staticPolymarketSearchClient, staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("polymarket");
    expect(candidates[0]?.side).toBe("buy_yes");
    expect(candidates[0]?.instrument).toBe("solana-etf-approved");
    expect(candidates[0]?.outcomeTokenId).toBe("123");
    expect(candidates[0]?.conditionId).toBe("condition_1");
    expect(candidates[0]?.resolutionRules).toBe("This market resolves Yes if a Solana ETF is approved by the deadline.");
    fetchMock.mockRestore();
  });

  it("selects semantically matching Polymarket results before quoting", async () => {
    const quotedTokens: string[] = [];
    const noisyMarkets = Array.from({ length: 12 }, (_, index) => ({
      id: `noise-${index}`,
      slug: `will-hyperliquid-reach-${index}-by-december-31-2026`,
      question: `Will Hyperliquid reach $${index} by December 31, 2026?`,
      active: true,
      closed: false,
      liquidityNum: 1000,
      clobTokenIds: JSON.stringify([`noise_yes_${index}`, `noise_no_${index}`]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      conditionId: `noise_condition_${index}`,
    }));
    const exactMarket = {
      id: "exact",
      slug: "microstrategy-sells-any-bitcoin-by-december-31-2026",
      question: "MicroStrategy sells any Bitcoin by December 31, 2026?",
      active: true,
      closed: false,
      liquidityNum: 12000,
      clobTokenIds: JSON.stringify(["exact_yes", "exact_no"]),
      outcomePrices: JSON.stringify(["0.875", "0.125"]),
      conditionId: "exact_condition",
    };
    const searchClient = {
      async searchMarkets(query: string) {
        return query === "broad" ? noisyMarkets : [exactMarket];
      },
      async fetchOrderBook(tokenId: string) {
        quotedTokens.push(tokenId);
        return {
          bids: [{ price: "0.86", size: "100" }],
          asks: [{ price: "0.89", size: "100" }],
        };
      },
      async fetchBuyPrice() {
        return 0.89;
      },
      async fetchSpread() {
        return 0.03;
      },
    };
    const selector = {
      async selectPolymarketSearchResults(input: { markets: Array<{ slug: string }> }) {
        expect(input.markets.map((market) => market.slug)).toContain(exactMarket.slug);
        return [exactMarket.slug];
      },
    };

    const candidates = await new PolymarketMarketDataProvider(
      searchClient,
      { async planPolymarketSearchQueries() { return ["broad", "exact"]; } },
      selector,
    ).findCandidates({
      thesis: {
        ...thesis,
        claim: "MicroStrategy may sell Bitcoin by year end.",
        direction: "bearish",
        mentionedAssets: ["MicroStrategy", "Bitcoin"],
      },
      tradeExpression: {
        signal: "strategy_bitcoin_sale",
        coreInterpretation: "The event market is YES even though the BTC price read-through is bearish.",
        directAsset: "BTC",
        directAssetTradable: true,
        evidenceConfidence: 0.8,
        marketDiscoveryConfidence: 0.6,
        tradeExpressionConfidence: 0.8,
        highestPurityExpression: "Buy yes on MicroStrategy selling any Bitcoin by Dec 31, 2026.",
        publicMarketReadThrough: "strong",
        candidates: [],
        rankedCandidates: [],
        candidateExpressions: [{
          expressionId: "strategy_sells_btc_yes",
          expressionRail: "prediction_market",
          expressionType: "event_probability",
          abstractMarket: "MicroStrategy sells any Bitcoin by Dec 31, 2026",
          intendedSide: "yes",
          primaryEntityOrEvent: "MicroStrategy sells Bitcoin",
          relatedEntities: ["Bitcoin"],
          thesis: "Buy yes on the exact event.",
          whyThisExpressesTheOpportunity: "It directly resolves the source claim.",
          directness: "direct",
          whatMustBeTrue: ["The market wording matches the event."],
          searchTerms: ["MicroStrategy sells Bitcoin before 2026-12-31"],
          requiredMarketFeatures: ["yes/no market"],
          requiredRuleOrContractFeatures: ["sale definition"],
          keyRisks: ["Resolution ambiguity"],
          expectedTimeHorizon: "months",
          priority: "high",
          confidence: 0.9,
        }],
        discardedExpressions: [],
        noTradeCase: null,
        decision: "needs_market_check",
        reason: "Search exact event.",
        insufficiency: null,
        marketRouterInstructions: "Prefer exact event.",
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.marketSlug).toBe(exactMarket.slug);
    expect(quotedTokens).toEqual(["exact_yes"]);
  });

  it("requires an AI query planner for Polymarket semantic discovery", async () => {
    await expect(new PolymarketMarketDataProvider().findCandidates({
      thesis,
    })).rejects.toBeInstanceOf(MissingConnectorConfigError);
  });

  it("requires AI result selection for Polymarket semantic discovery", async () => {
    await expect(new PolymarketMarketDataProvider(staticPolymarketSearchClient, staticPolymarketQueryPlanner).findCandidates({
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

    const candidates = await new PolymarketMarketDataProvider(searchClient, staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
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

  it("searches Polymarket through Gamma events search", async () => {
    const requests: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.toString());

      expect(url.pathname).toBe("/events");
      expect(url.searchParams.get("search")).toBe("ethereum researchers");
      expect(url.searchParams.get("active")).toBe("true");
      expect(url.searchParams.get("closed")).toBe("false");
      expect(url.searchParams.get("limit")).toBe("7");

      return new Response(JSON.stringify([
        {
          id: "event_1",
          slug: "ethereum-price-event",
          title: "Ethereum price event",
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
              clobTokenIds: ["yes_token", "no-token"],
              marketMakerAddress: "0x0000000000000000000000000000000000000000",
              liquidityNum: 12000,
              volumeNum: 50000,
            },
          ],
        },
      ]));
    });

    const markets = await new PolymarketSdkSearchClient().searchMarkets("ethereum researchers", 7);

    expect(requests).toHaveLength(1);
    expect(markets[0]?.slug).toBe("will-ethereum-researchers-resign");
    expect(markets[0]?.clobTokenIds).toEqual(["yes_token", "no-token"]);
    fetchMock.mockRestore();
  });

  it("surfaces Polymarket order book failures instead of dropping the venue", async () => {
    const searchClient = {
      ...staticPolymarketSearchClient,
      async fetchOrderBook() {
        throw new ConnectorRequestError("Polymarket order book", 503, "upstream unavailable");
      },
    };

    await expect(new PolymarketMarketDataProvider(searchClient, staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    })).rejects.toBeInstanceOf(ConnectorRequestError);
  });

  it("skips Polymarket markets with empty books and keeps later tradable matches", async () => {
    const markets: PolymarketSearchMarket[] = [
      {
        id: "empty",
        slug: "empty-book-market",
        question: "Will the empty book market resolve yes?",
        active: true,
        closed: false,
        liquidityNum: 1000,
        clobTokenIds: JSON.stringify(["empty_yes", "empty_no"]),
        outcomePrices: JSON.stringify(["0.5", "0.5"]),
        conditionId: "empty_condition",
      },
      {
        id: "tradable",
        slug: "tradable-market",
        question: "Will the tradable market resolve yes?",
        active: true,
        closed: false,
        liquidityNum: 1000,
        clobTokenIds: JSON.stringify(["tradable_yes", "tradable_no"]),
        outcomePrices: JSON.stringify(["0.6", "0.4"]),
        conditionId: "tradable_condition",
      },
    ];
    const searchClient = {
      ...polymarketSearchClientFor(markets),
      async fetchOrderBook(tokenId: string) {
        if (tokenId === "tradable_yes") {
          return {
            bids: [{ price: "0.59", size: "100" }],
            asks: [{ price: "0.61", size: "100" }],
          };
        }
        return { bids: [], asks: [] };
      },
    };

    const candidates = await new PolymarketMarketDataProvider(searchClient, staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.marketSlug).toBe("tradable-market");
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
    ]), staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    })).rejects.toThrow("condition_id");
    fetchMock.mockRestore();
  });

  it("rejects malformed Polymarket token ID arrays with provider-field context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
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
    ]), staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field clobTokenIds for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects malformed Polymarket outcome price arrays with provider-field context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
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
    ]), staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field outcomePrices for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects nonnumeric Polymarket outcome prices instead of dropping them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
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
        outcomePrices: JSON.stringify(["bad", "0.38"]),
        conditionId: "condition_1",
      },
    ]), staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field outcomePrices for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects blank Polymarket outcome prices instead of treating them as zero", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
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
        outcomePrices: JSON.stringify(["", "0.38"]),
        conditionId: "condition_1",
      },
    ]), staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
      thesis,
    })).rejects.toThrow("Malformed Polymarket provider field outcomePrices for market solana-etf-approved");
    fetchMock.mockRestore();
  });

  it("rejects parsed Polymarket arrays containing non-string values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
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
        clobTokenIds: ["123", 456] as unknown as string[],
        outcomePrices: JSON.stringify(["0.62", "0.38"]),
        conditionId: "condition_1",
      },
    ]), staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findCandidates({
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
        liquidityNum: 900,
        volumeNum: 12000,
        clobTokenIds: JSON.stringify(["yes-token", "no-token"]),
        outcomePrices: JSON.stringify(["0.37", "0.63"]),
        conditionId: "condition_1",
        endDate: "2026-09-01T00:00:00Z",
      },
    ], {
      bids: [{ price: "0.63", size: "100" }],
      asks: [{ price: "0.65", size: "100" }],
    }), staticPolymarketQueryPlanner, staticPolymarketSearchResultSelector).findPolymarketMarkets({
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
      warnings: ["liquidity_under_1000"],
    });
    fetchMock.mockRestore();
  });
});
