import type { MarketCandidate, ResearchReport, Thesis, TradeExpressionPlan } from "../core/schemas/index.ts";
import type { MarketDataProvider } from "../ai/tools/market.ts";
import { readJsonResponse } from "../core/connector-errors.ts";

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
      new PolymarketMarketDataProvider(),
    ],
  ) {}

  async findCandidates(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate[]> {
    const results = await Promise.allSettled(
      this.providers.map((provider) => provider.findCandidates(input)),
    );

    return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
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

export class PolymarketMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly endpoint = "https://gamma-api.polymarket.com/markets",
    private readonly clobEndpoint = "https://clob.polymarket.com",
  ) {}

  async findCandidates(input: { thesis: Thesis; tradeExpression?: TradeExpressionPlan }): Promise<MarketCandidate[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("limit", "10");
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("search", polymarketSearchQuery(input.thesis, input.tradeExpression));

    const response = await fetch(url);
    const marketsResponse = await readJsonResponse<PolymarketMarketsResponse>("Polymarket market data", response);
    const markets = Array.isArray(marketsResponse)
      ? marketsResponse
      : marketsResponse.data ?? marketsResponse.markets ?? [];

    const candidates = await Promise.all(markets
      .filter((market) => market.active !== false && market.closed !== true)
      .map(async (market) => {
        const buyNo = input.thesis.direction === "bearish";
        const tokenIds = parseStringArray(market.clobTokenIds);
        const prices = parseNumberArray(market.outcomePrices);
        const yesPrice = prices[0] ?? null;
        const outcomeTokenId = tokenIds[buyNo ? 1 : 0] ?? null;
        const heldPrice = yesPrice == null ? null : buyNo ? 1 - yesPrice : yesPrice;
        const book = outcomeTokenId ? await this.getBook(outcomeTokenId) : null;
        const metrics = book ? orderBookMetrics(book.bids ?? [], book.asks ?? []) : null;

        return {
          venue: "polymarket",
          instrument: market.slug ?? market.id ?? market.question ?? "polymarket",
          side: buyNo ? "buy_no" as const : "buy_yes" as const,
          symbol: market.slug ?? market.id ?? market.question ?? "unknown",
          conditionId: market.conditionId ?? null,
          outcomeTokenId,
          markPrice: metrics?.mid ?? (heldPrice && heldPrice > 0 ? heldPrice : null),
          liquidityScore: Math.min(1, Number(market.liquidityNum ?? market.volumeNum ?? 0) / 500_000),
          spreadBps: metrics?.spreadBps ?? 0,
          estimatedSlippageBps: metrics?.estimatedSlippageBps ?? 0,
          minOrderSizeUsd: 1,
          thesisFit: input.thesis.confidence,
          reason: market.question ?? "Prediction market related to the thesis.",
        };
      }));

    return candidates.filter((candidate) => candidate.outcomeTokenId && candidate.spreadBps > 0);
  }

  private async getBook(tokenId: string): Promise<PolymarketBook | null> {
    const url = new URL(`/book`, this.clobEndpoint);
    url.searchParams.set("token_id", tokenId);
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

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

function candidateSymbols(thesis: Thesis, tradeExpression?: TradeExpressionPlan): Set<string> {
  const values = [
    ...thesis.mentionedAssets,
    tradeExpression?.directAsset,
    ...(tradeExpression?.candidates.map((candidate) => candidate.instrument) ?? []),
  ].filter((value): value is string => Boolean(value));

  return new Set(values.flatMap(symbolAliases));
}

function symbolAliases(value: string): string[] {
  const trimmed = value.trim();
  const withoutPair = trimmed.replace(/-USDC$/i, "").replace(/\/USDC$/i, "");
  const withoutPerp = withoutPair.replace(/\s+perp$/i, "");
  const normalized = withoutPerp.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const aliases = [trimmed, withoutPair, withoutPerp];

  if (normalized === "SPACEX") {
    aliases.push("SPCX");
  }
  if (normalized === "COINBASE") {
    aliases.push("COIN");
  }

  return Array.from(new Set(aliases.filter(Boolean)));
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

function polymarketSearchQuery(thesis: Thesis, tradeExpression?: TradeExpressionPlan): string {
  const directAsset = tradeExpression?.directAsset;
  const instruments = tradeExpression?.candidates.map((candidate) => candidate.instrument).join(" ");
  return [directAsset, instruments, thesis.claim].filter(Boolean).join(" ");
}
