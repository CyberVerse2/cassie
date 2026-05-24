import type {
  MarketCandidate,
  PolymarketMarketAssessment,
  PolymarketQuote,
  Thesis,
  TradeExpressionPlan,
} from "../core/schemas/index.ts";
import type { MarketDataProvider, PolymarketDiscoveryQueryPlanner, PolymarketMarketFinder } from "./selection.ts";
import { MissingConnectorConfigError, readJsonResponse } from "../core/helpers/index.ts";
import {
  loadHyperliquidCatalog,
  searchHyperliquidCatalog,
  type HyperliquidCatalogAsset,
} from "./hyperliquid/catalog.ts";

type HyperliquidMetaAndCtxs = [
  {
    universe: Array<{
      name: string;
      szDecimals?: number;
      maxLeverage?: number;
      onlyIsolated?: boolean;
      marginMode?: string;
    }>;
  },
  Array<{
    markPx?: string;
    midPx?: string;
    dayNtlVlm?: string;
    funding?: string;
  }>,
];

type HyperliquidUniverseAsset = HyperliquidMetaAndCtxs[0]["universe"][number];
type HyperliquidAssetCtx = HyperliquidMetaAndCtxs[1][number];

type HyperliquidL2Book = {
  levels?: [
    Array<{ px: string; sz: string }>,
    Array<{ px: string; sz: string }>,
  ];
};

type PolymarketMarket = {
  id?: string;
  question?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  liquidityNum?: number;
  volumeNum?: number;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  conditionId?: string;
  endDate?: string;
};

type NormalizedPolymarketMarket = {
  id: string | null;
  question: string;
  slug: string;
  conditionId: string;
  tokenIds: string[];
  yesPrice: number | null;
  noPrice: number | null;
  volumeUsd: number;
  liquidityUsd: number;
  endDate: string | null;
};

type PolymarketMarketsResponse = PolymarketMarket[] | {
  data?: PolymarketMarket[];
  markets?: PolymarketMarket[];
};

type PolymarketBook = {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
};

const POLYMARKET_LIQUIDITY_SCORE_FULL_USD = 500_000;
const POLYMARKET_LOW_LIQUIDITY_WARNING_USD = 10_000;

export class CompositeMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly providers: MarketDataProvider[] = [
      new HyperliquidMarketDataProvider(),
    ],
  ) {}

  async findCandidates(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate[]> {
    const results = await Promise.all(this.providers.map((provider) => provider.findCandidates(input)));
    return results.flat();
  }
}

export class HyperliquidMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly endpoint = "https://api.hyperliquid.xyz/info",
    private readonly catalog?: HyperliquidCatalogAsset[],
  ) {}

  async findCandidates(input: { thesis: Thesis; tradeExpression?: TradeExpressionPlan }): Promise<MarketCandidate[]> {
    const catalogMatches = await this.findCatalogMatches(input);
    return this.marketCandidatesFromCatalogAssets(catalogMatches, input.thesis);
  }

  private async getMetaAndAssetCtxs(dex?: string | null): Promise<HyperliquidMetaAndCtxs> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "metaAndAssetCtxs",
        ...(dex ? { dex } : {}),
      }),
    });

    return readJsonResponse<HyperliquidMetaAndCtxs>("Hyperliquid market data", response);
  }

  private async findCatalogMatches(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<HyperliquidCatalogAsset[]> {
    const catalog = this.catalog ?? await loadHyperliquidCatalog().catch(() => []);
    const query = hyperliquidCatalogQuery(input.thesis, input.tradeExpression);

    return searchHyperliquidCatalog(catalog, query, 10, {
      exactSymbolTokens: hyperliquidExactSymbolTokens(input.thesis, input.tradeExpression),
    })
      .filter((asset) => asset.surface !== "spot");
  }

  private async marketCandidatesFromCatalogAssets(
    catalogAssets: HyperliquidCatalogAsset[],
    thesis: Thesis,
  ): Promise<MarketCandidate[]> {
    const byDex = new Map<string, HyperliquidCatalogAsset[]>();
    for (const asset of catalogAssets) {
      const key = asset.dex ?? "";
      byDex.set(key, [...(byDex.get(key) ?? []), asset]);
    }

    const candidates: MarketCandidate[] = [];
    for (const [dexKey, assets] of byDex) {
      const dex = dexKey || null;
      const [meta, ctxs] = await this.getMetaAndAssetCtxs(dex);
      for (const catalogAsset of assets) {
        const index = meta.universe.findIndex((asset) => asset.name === catalogAsset.symbol);
        if (index < 0) {
          throw new Error(`Hyperliquid catalog asset ${catalogAsset.symbol} was not found in live ${catalogAsset.dex ?? "native"} metadata.`);
        }

        const candidate = await this.marketCandidateFromLiveAsset({
          asset: meta.universe[index]!,
          ctx: ctxs[index],
          instrument: catalogAsset.instrumentType,
          thesis,
        });
        if (candidate) candidates.push(candidate);
      }
    }

    return candidates;
  }

  private async marketCandidateFromLiveAsset(input: {
    asset: HyperliquidUniverseAsset;
    ctx?: HyperliquidAssetCtx;
    instrument: string;
    thesis: Thesis;
  }): Promise<MarketCandidate | null> {
    const volume = Number(input.ctx?.dayNtlVlm ?? 0);
    const book = await this.getL2Book(input.asset.name);
    const bookMetrics = orderBookMetrics(book.levels?.[0] ?? [], book.levels?.[1] ?? []);

    if (!bookMetrics) {
      return null;
    }

    return {
      venue: "hyperliquid",
      instrument: input.instrument,
      side: input.thesis.direction === "bearish" ? "short" : "long",
      symbol: input.asset.name,
      markPrice: Number(input.ctx?.markPx ?? input.ctx?.midPx ?? bookMetrics?.mid ?? 0) || null,
      liquidityScore: Math.min(1, volume / 50_000_000),
      spreadBps: bookMetrics.spreadBps,
      estimatedSlippageBps: bookMetrics.estimatedSlippageBps,
      minOrderSizeUsd: 10,
      thesisFit: input.thesis.confidence,
      reason: `${input.asset.name} ${input.instrument} directly maps to the thesis asset.`,
    } satisfies MarketCandidate;
  }

  private async getL2Book(coin: string): Promise<HyperliquidL2Book> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin }),
    });

    return readJsonResponse<HyperliquidL2Book>("Hyperliquid l2 book", response);
  }
}

function hyperliquidCatalogQuery(thesis: Thesis, tradeExpression?: TradeExpressionPlan): string {
  return [
    thesis.claim,
    thesis.literalClaim,
    thesis.impliedTradeThesis,
    thesis.sourceOrMetaSignal,
    ...thesis.mentionedAssets,
    ...thesis.topics,
    tradeExpression?.signal,
    tradeExpression?.coreInterpretation,
    tradeExpression?.directAsset,
    tradeExpression?.highestPurityExpression,
    tradeExpression?.marketRouterInstructions,
    ...(tradeExpression?.candidates.flatMap((candidate) => [
      candidate.instrument,
      candidate.symbol,
      candidate.venueQuery,
      candidate.thesis,
      ...(candidate.venueChecks ?? []),
    ]) ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function hyperliquidExactSymbolTokens(thesis: Thesis, tradeExpression?: TradeExpressionPlan): string[] {
  return [
    ...thesis.mentionedAssets,
    tradeExpression?.directAsset,
    ...(tradeExpression?.candidates.flatMap((candidate) => [
      candidate.symbol,
      candidate.instrument,
    ]) ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .filter(isExactSymbolAnchor);
}

function isExactSymbolAnchor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.includes("unknown") || normalized.includes("proxy")) return false;
  return /^[a-z0-9:_/-]+$/i.test(value.trim());
}

export class PolymarketMarketDataProvider implements MarketDataProvider, PolymarketMarketFinder {
  constructor(
    private readonly endpoint = "https://gamma-api.polymarket.com/markets",
    private readonly clobEndpoint = "https://clob.polymarket.com",
    private readonly queryPlanner?: PolymarketDiscoveryQueryPlanner,
  ) {}

  async findCandidates(input: { thesis: Thesis; tradeExpression?: TradeExpressionPlan }): Promise<MarketCandidate[]> {
    return this.findPolymarketMarkets(input);
  }

  async findPolymarketMarkets(input: { thesis: Thesis; tradeExpression?: TradeExpressionPlan; limit?: number }): Promise<MarketCandidate[]> {
    if (!this.queryPlanner) {
      throw new MissingConnectorConfigError("Polymarket semantic discovery", "AiPolymarketDiscoveryQueryPlanner");
    }

    const queries = await this.queryPlanner.planPolymarketSearchQueries(input);
    const marketResponses = await Promise.all(queries.map(async (query) => {
      const url = new URL(this.endpoint);
      url.searchParams.set("limit", String(input.limit ?? 10));
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("search", query);

      const response = await fetch(url);
      const marketsResponse = await readJsonResponse<PolymarketMarketsResponse>("Polymarket market data", response);
      return Array.isArray(marketsResponse)
        ? marketsResponse
        : marketsResponse.data ?? marketsResponse.markets ?? [];
    }));
    const markets = uniquePolymarketMarkets(marketResponses.flat());

    const candidates = await Promise.all(markets
      .filter((market) => market.active !== false && market.closed !== true)
      .map(async (market) => {
        const buyNo = input.thesis.direction === "bearish";
        const normalized = normalizePolymarketMarket(market);
        const outcome: "yes" | "no" = buyNo ? "no" : "yes";
        const outcomeTokenId = normalized.tokenIds[buyNo ? 1 : 0] ?? null;
        const heldPrice = outcome === "no" ? normalized.noPrice : normalized.yesPrice;
        if (!outcomeTokenId) {
          throw new Error(`Polymarket market ${market.slug ?? market.id ?? market.question ?? "unknown"} has no outcome token id.`);
        }

        const book = await this.getBook(outcomeTokenId);
        const metrics = orderBookMetrics(book.bids ?? [], book.asks ?? []);

        if (!metrics) {
          throw new Error(`Polymarket order book is empty for token ${outcomeTokenId}.`);
        }

        const warnings = polymarketWarnings(normalized);

        return {
          venue: "polymarket",
          instrument: normalized.slug,
          side: outcome === "no" ? "buy_no" as const : "buy_yes" as const,
          symbol: normalized.slug,
          conditionId: normalized.conditionId,
          outcomeTokenId,
          yesOutcomeTokenId: normalized.tokenIds[0] ?? null,
          noOutcomeTokenId: normalized.tokenIds[1] ?? null,
          marketQuestion: normalized.question,
          marketSlug: normalized.slug,
          outcome,
          yesPrice: normalized.yesPrice,
          noPrice: normalized.noPrice,
          heldSidePrice: metrics.mid ?? heldPrice,
          volumeUsd: normalized.volumeUsd,
          liquidityUsd: normalized.liquidityUsd,
          endDate: normalized.endDate,
          markPrice: metrics.mid ?? (heldPrice && heldPrice > 0 ? heldPrice : null),
          liquidityScore: Math.min(1, Math.max(normalized.liquidityUsd, normalized.volumeUsd) / POLYMARKET_LIQUIDITY_SCORE_FULL_USD),
          spreadBps: metrics.spreadBps,
          estimatedSlippageBps: metrics.estimatedSlippageBps,
          minOrderSizeUsd: 1,
          thesisFit: input.thesis.confidence,
          reason: normalized.question,
          ...(warnings.length ? { warnings } : {}),
        };
      }));

    return candidates.filter((candidate) => candidate.spreadBps > 0);
  }

  async assessPolymarketMarket(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    market: { conditionId?: string | null; marketSlug?: string | null; question?: string | null };
    side: "yes" | "no";
  }): Promise<PolymarketMarketAssessment> {
    const candidates = await this.findPolymarketMarkets({
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
      limit: 20,
    });
    const candidate = candidates.find((item) => {
      if (input.market.conditionId && item.conditionId === input.market.conditionId) return true;
      if (input.market.marketSlug && item.marketSlug === input.market.marketSlug) return true;
      if (input.market.question && item.marketQuestion === input.market.question) return true;
      return false;
    });

    if (!candidate) {
      throw new Error("Polymarket assessment could not find the requested market in live discovery results.");
    }

    const wantsNo = input.side === "no";
    const trade = candidate.side === (wantsNo ? "buy_no" : "buy_yes")
      ? candidate
      : await this.flipPolymarketCandidateSide(candidate, input.side);

    if (!trade.conditionId || !trade.outcomeTokenId || !trade.marketQuestion || !trade.marketSlug || !trade.outcome || trade.yesPrice == null || trade.noPrice == null || trade.heldSidePrice == null) {
      throw new Error("Polymarket assessment requires condition_id, outcome token, question, slug, outcome, and normalized prices.");
    }

    const warnings = Array.from(new Set([...(trade.warnings ?? [])]));
    return {
      fit: trade.thesisFit >= 0.7 ? "strong" : trade.thesisFit >= 0.4 ? "weak" : "no_fit",
      fitReason: trade.reason,
      warnings,
      trade: {
        ...trade,
        venue: "polymarket",
        conditionId: trade.conditionId,
        outcomeTokenId: trade.outcomeTokenId,
        marketQuestion: trade.marketQuestion,
        marketSlug: trade.marketSlug,
        outcome: trade.outcome,
        yesPrice: trade.yesPrice,
        noPrice: trade.noPrice,
        heldSidePrice: trade.heldSidePrice,
      },
    };
  }

  async quotePolymarketMarket(input: {
    conditionId?: string | null;
    outcomeTokenId: string;
    side: "yes" | "no";
    yesPrice?: number | null;
    noPrice?: number | null;
  }): Promise<PolymarketQuote> {
    const book = await this.getBook(input.outcomeTokenId);
    const metrics = orderBookMetrics(book.bids ?? [], book.asks ?? []);
    if (!metrics) {
      throw new Error(`Polymarket order book is empty for token ${input.outcomeTokenId}.`);
    }
    const bid = topBid(book.bids ?? []);
    const ask = topAsk(book.asks ?? []);
    if (!bid || !ask) {
      throw new Error(`Polymarket order book is empty for token ${input.outcomeTokenId}.`);
    }
    const heldSidePrice = metrics.mid;

    return {
      conditionId: input.conditionId ?? null,
      outcomeTokenId: input.outcomeTokenId,
      outcome: input.side,
      yesPrice: input.side === "yes" ? heldSidePrice : input.yesPrice ?? null,
      noPrice: input.side === "no" ? heldSidePrice : input.noPrice ?? null,
      heldSidePrice,
      bid,
      ask,
      midPrice: heldSidePrice,
      spreadBps: metrics.spreadBps,
      timestamp: new Date().toISOString(),
    };
  }

  private async flipPolymarketCandidateSide(candidate: MarketCandidate, side: "yes" | "no"): Promise<MarketCandidate> {
    const outcomeTokenId = side === "yes" ? candidate.yesOutcomeTokenId : candidate.noOutcomeTokenId;
    if (!outcomeTokenId) {
      throw new Error("Cannot flip a Polymarket candidate without both outcome token IDs from discovery.");
    }
    const quote = await this.quotePolymarketMarket({
      conditionId: candidate.conditionId,
      outcomeTokenId,
      side,
      yesPrice: candidate.yesPrice,
      noPrice: candidate.noPrice,
    });
    return {
      ...candidate,
      side: side === "yes" ? "buy_yes" : "buy_no",
      outcomeTokenId,
      outcome: side,
      heldSidePrice: quote.heldSidePrice,
      markPrice: quote.midPrice,
      spreadBps: quote.spreadBps,
    };
  }

  private async getBook(tokenId: string): Promise<PolymarketBook> {
    const url = new URL(`/book`, this.clobEndpoint);
    url.searchParams.set("token_id", tokenId);
    const response = await fetch(url);

    return readJsonResponse<PolymarketBook>("Polymarket order book", response);
  }
}

function orderBookMetrics(
  bids: Array<{ px?: string; price?: string; sz?: string; size?: string }>,
  asks: Array<{ px?: string; price?: string; sz?: string; size?: string }>,
) {
  const bid = bids.map((level) => Number(level.px ?? level.price)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const ask = asks.map((level) => Number(level.px ?? level.price)).filter(Number.isFinite).sort((a, b) => a - b)[0];

  if (!bid || !ask || bid <= 0 || ask <= 0) {
    return null;
  }

  const mid = (bid + ask) / 2;
  const spreadBps = Math.round(((ask - bid) / mid) * 10_000);
  const estimatedSlippageBps = estimateBuySlippageBps(asks, 50, ask);
  return { mid, spreadBps, estimatedSlippageBps };
}

function topBid(bids: Array<{ px?: string; price?: string }>): number | null {
  return bids.map((level) => Number(level.px ?? level.price)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
}

function topAsk(asks: Array<{ px?: string; price?: string }>): number | null {
  return asks.map((level) => Number(level.px ?? level.price)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
}

function estimateBuySlippageBps(
  asks: Array<{ px?: string; price?: string; sz?: string; size?: string }>,
  notionalUsd: number,
  bestAsk: number,
): number {
  let remaining = notionalUsd;
  let spent = 0;
  let acquired = 0;

  for (const level of asks) {
    const price = Number(level.px ?? level.price);
    const size = Number(level.sz ?? level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) continue;
    const levelNotional = price * size;
    const spend = Math.min(remaining, levelNotional);
    spent += spend;
    acquired += spend / price;
    remaining -= spend;
    if (remaining <= 0) break;
  }

  if (spent <= 0 || acquired <= 0) {
    return 0;
  }

  const averagePrice = spent / acquired;
  return Math.max(0, Math.round(((averagePrice - bestAsk) / bestAsk) * 10_000));
}

function parseStringArray(value: string | string[] | undefined, context: { field: string; market: string }): string[] {
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string")) {
      throw malformedPolymarketStringArrayError(context);
    }
    return value;
  }
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw malformedPolymarketStringArrayError(context, error);
  }

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw malformedPolymarketStringArrayError(context);
  }

  return parsed;
}

function parseNumberArray(value: string | string[] | undefined, context: { field: string; market: string }): number[] {
  return parseStringArray(value, context).map(Number).filter(Number.isFinite);
}

function malformedPolymarketStringArrayError(context: { field: string; market: string }, cause?: unknown): Error {
  const causeMessage = cause instanceof Error ? ` ${cause.message}` : "";
  return new Error(`Malformed Polymarket provider field ${context.field} for market ${context.market}. Expected a JSON array of strings or string[].${causeMessage}`);
}

function normalizePolymarketMarket(market: PolymarketMarket): NormalizedPolymarketMarket {
  const slug = market.slug ?? market.id ?? market.question;
  if (!slug) {
    throw new Error("Polymarket market is missing a slug.");
  }
  if (!market.conditionId) {
    throw new Error(`Polymarket market ${slug} is missing condition_id.`);
  }

  const tokenIds = parseStringArray(market.clobTokenIds, { field: "clobTokenIds", market: slug });
  const prices = parseNumberArray(market.outcomePrices, { field: "outcomePrices", market: slug });
  const yesPrice = prices[0] ?? null;
  const noPrice = prices[1] ?? (yesPrice == null ? null : 1 - yesPrice);

  return {
    id: market.id ?? null,
    question: market.question ?? slug,
    slug,
    conditionId: market.conditionId,
    tokenIds,
    yesPrice,
    noPrice,
    volumeUsd: Number(market.volumeNum ?? 0) || 0,
    liquidityUsd: Number(market.liquidityNum ?? 0) || 0,
    endDate: market.endDate ?? null,
  };
}

function polymarketWarnings(market: NormalizedPolymarketMarket): string[] {
  const warnings: string[] = [];
  if (market.liquidityUsd < POLYMARKET_LOW_LIQUIDITY_WARNING_USD) {
    warnings.push("liquidity_under_10000");
  }
  if (!market.endDate) {
    warnings.push("missing_resolution_date");
  }
  return warnings;
}

function uniquePolymarketMarkets(markets: PolymarketMarket[]): PolymarketMarket[] {
  const seen = new Set<string>();
  const unique: PolymarketMarket[] = [];

  for (const market of markets) {
    const key = market.conditionId ?? market.slug ?? market.id ?? market.question;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(market);
  }

  return unique;
}
