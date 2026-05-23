import type {
  MarketCandidate,
  PolymarketMarketAssessment,
  PolymarketQuote,
  ResearchReport,
  Thesis,
  TradeExpressionPlan,
} from "../core/schemas/index.ts";
import type { MarketDataProvider, PolymarketDiscoveryQueryPlanner, PolymarketMarketFinder } from "../agent/tools/market.ts";
import { MissingConnectorConfigError, readJsonResponse } from "../core/connector-errors.ts";

type HyperliquidMetaAndCtxs = [
  {
    universe: Array<{
      name: string;
      szDecimals?: number;
    }>;
  },
  Array<{
    markPx?: string;
    midPx?: string;
    dayNtlVlm?: string;
    funding?: string;
  }>,
];

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

export class CompositeMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly providers: MarketDataProvider[] = [
      new HyperliquidMarketDataProvider(),
    ],
  ) {}

  async findCandidates(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate[]> {
    const results = await Promise.all(this.providers.map((provider) => provider.findCandidates(input)));
    return results.flat();
  }
}

export class HyperliquidMarketDataProvider implements MarketDataProvider {
  constructor(private readonly endpoint = "https://api.hyperliquid.xyz/info") {}

  async findCandidates(input: { thesis: Thesis; tradeExpression?: TradeExpressionPlan }): Promise<MarketCandidate[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const [meta, ctxs] = await readJsonResponse<HyperliquidMetaAndCtxs>("Hyperliquid market data", response);

    const symbols = candidateSymbols(input.thesis, input.tradeExpression);
    const matches = meta.universe
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) => symbols.has(asset.name));

    return Promise.all(
      matches.map(async ({ asset, index }) => {
        const ctx = ctxs[index];
        const volume = Number(ctx?.dayNtlVlm ?? 0);
        const book = await this.getL2Book(asset.name);
        const bookMetrics = orderBookMetrics(book.levels?.[0] ?? [], book.levels?.[1] ?? []);

        if (!bookMetrics) {
          throw new Error(`Hyperliquid l2 book is empty for ${asset.name}.`);
        }

        const isPreStock = isPreStockPerp(asset.name, input.thesis, input.tradeExpression);

        return {
          venue: "hyperliquid",
          instrument: isPreStock ? "pre_stock_perp" : "perp",
          side: input.thesis.direction === "bearish" ? "short" : "long",
          symbol: asset.name,
          markPrice: Number(ctx?.markPx ?? ctx?.midPx ?? bookMetrics?.mid ?? 0) || null,
          liquidityScore: Math.min(1, volume / 50_000_000),
          spreadBps: bookMetrics.spreadBps,
          estimatedSlippageBps: bookMetrics.estimatedSlippageBps,
          minOrderSizeUsd: 10,
          thesisFit: input.thesis.confidence,
          reason: `${asset.name} perp directly maps to the thesis asset.`,
        } satisfies MarketCandidate;
      }),
    );
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
          liquidityScore: Math.min(1, Math.max(normalized.liquidityUsd, normalized.volumeUsd) / 500_000),
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
    researchReport?: ResearchReport;
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

function parseStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseNumberArray(value: string | string[] | undefined): number[] {
  return parseStringArray(value).map(Number).filter(Number.isFinite);
}

function normalizePolymarketMarket(market: PolymarketMarket): NormalizedPolymarketMarket {
  const slug = market.slug ?? market.id ?? market.question;
  if (!slug) {
    throw new Error("Polymarket market is missing a slug.");
  }
  if (!market.conditionId) {
    throw new Error(`Polymarket market ${slug} is missing condition_id.`);
  }

  const tokenIds = parseStringArray(market.clobTokenIds);
  const prices = parseNumberArray(market.outcomePrices);
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
  if (market.liquidityUsd < 10_000) {
    warnings.push("liquidity_under_10000");
  }
  if (!market.endDate) {
    warnings.push("missing_resolution_date");
  }
  return warnings;
}

function candidateSymbols(thesis: Thesis, tradeExpression?: TradeExpressionPlan): Set<string> {
  const values = [
    ...thesis.mentionedAssets,
    tradeExpression?.directAsset,
    ...(tradeExpression?.candidates.flatMap((candidate) => [
      candidate.instrument,
      candidate.symbol,
      candidate.venueQuery,
      ...(candidate.venueChecks ?? []),
    ]) ?? []),
  ].filter((value): value is string => Boolean(value));

  return new Set(values.flatMap(symbolAliases));
}

function symbolAliases(value: string): string[] {
  const trimmed = value.trim();
  const withoutPair = trimmed.replace(/[-/]USD[CTE]?$/i, "");
  const withoutPerp = withoutPair.replace(/\s+perp$/i, "");
  const normalized = withoutPerp.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const bases = symbolParts(withoutPerp);
  const aliases = [trimmed, withoutPair, withoutPerp, ...bases];

  for (const base of bases) {
    aliases.push(`${base}-USDC`, `${base}/USDC`, `${base}-USDE`, `${base}/USDE`, `${base}-USDT`, `${base}/USDT`);
  }

  if (normalized === "SPACEX") {
    aliases.push("SPCX");
  }
  if (normalized === "COINBASE") {
    aliases.push("COIN");
  }

  return Array.from(new Set(aliases.filter(Boolean)));
}

function symbolParts(value: string): string[] {
  const ignored = new Set(["PAIR", "PERP", "SPOT", "MARKET", "USD", "USDC", "USDE", "USDT"]);
  const parts = value
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((part) => /^[A-Z][A-Z0-9]{1,9}$/.test(part) && !ignored.has(part));

  return Array.from(new Set(parts));
}

function isPreStockPerp(symbol: string, thesis: Thesis, tradeExpression?: TradeExpressionPlan): boolean {
  const context = [
    symbol,
    thesis.claim,
    ...thesis.topics,
    tradeExpression?.coreInterpretation,
    tradeExpression?.highestPurityExpression,
    tradeExpression?.marketRouterInstructions,
  ].filter(Boolean).join(" ").toLowerCase();

  return context.includes("pre-stock") || context.includes("pre stock") || context.includes("pre-ipo") || context.includes("ipo");
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
