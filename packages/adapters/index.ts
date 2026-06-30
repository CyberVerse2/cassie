import type { OrderBook, PublicClient } from "@polymarket/client";
import type {
  MarketCandidate,
  PolymarketMarketAssessment,
  PolymarketQuote,
  Thesis,
  TradeExpressionPlan,
} from "../core/schemas/index.ts";
import type {
  MarketDataProvider,
  PolymarketDiscoveryQueryPlanner,
  PolymarketMarketFinder,
  PolymarketSearchResultForSelection,
  PolymarketSearchResultSelector,
} from "./selection.ts";
import {
  MissingConnectorConfigError,
  readJsonResponse,
} from "../core/helpers/connector-errors.ts";
import {
  isConfiguredDirectVenueExpressionRail,
  isDirectEnoughForConfiguredVenueSearch,
} from "../core/expression-rails.ts";

type HyperliquidMetaAndCtxs = [
  {
    collateralToken?: number;
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

type HyperliquidSpotMetaAndCtxs = [
  {
    universe: Array<{
      name: string;
      tokens: number[];
      index: number;
      isCanonical: boolean;
    }>;
    tokens: Array<{
      name: string;
      fullName: string | null;
      szDecimals: number;
      index: number;
      isCanonical: boolean;
    }>;
  },
  Array<{
    coin?: string;
    markPx?: string;
    midPx?: string;
    dayNtlVlm?: string;
  }>,
];

type HyperliquidAssetCtx = HyperliquidMetaAndCtxs[1][number];
type HyperliquidSpotUniverseAsset =
  HyperliquidSpotMetaAndCtxs[0]["universe"][number];
type HyperliquidSpotToken = HyperliquidSpotMetaAndCtxs[0]["tokens"][number];
type HyperliquidPerpDexs = (null | { name: string })[];

type HyperliquidL2Book = {
  levels?: [
    Array<{ px: string; sz: string }>,
    Array<{ px: string; sz: string }>,
  ];
};

type HyperliquidLiveAssetMatch = {
  kind: "perp" | "spot";
  symbol: string;
  bookCoin: string;
  sizeDecimals: number;
  ctx?: HyperliquidAssetCtx;
  instrument: string;
  reasonAssetName: string;
  tradeExpression?: TradeExpressionPlan;
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
  description?: string;
  resolutionSource?: string;
};

type PolymarketGammaEvent = {
  markets?: PolymarketMarket[];
};

export interface PolymarketSearchClient {
  searchMarkets(query: string, limit: number): Promise<PolymarketMarket[]>;
  fetchOrderBook(tokenId: string): Promise<PolymarketBook>;
  fetchBuyPrice(tokenId: string): Promise<number | null>;
  fetchSpread(tokenId: string): Promise<number | null>;
}

export class PolymarketSdkSearchClient implements PolymarketSearchClient {
  constructor(private client?: PublicClient) {}

  async searchMarkets(
    query: string,
    limit: number,
  ): Promise<PolymarketMarket[]> {
    const url = new URL("https://gamma-api.polymarket.com/events");
    url.searchParams.set("search", query);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    const events = await readJsonResponse<PolymarketGammaEvent[]>(
      "Polymarket event search",
      await fetch(url),
    );
    return events.flatMap((event) => event.markets ?? []);
  }

  async fetchOrderBook(tokenId: string): Promise<PolymarketBook> {
    const client = await this.getClient();
    return polymarketBookFromSdkBook(await client.fetchOrderBook({ tokenId }));
  }

  async fetchBuyPrice(tokenId: string): Promise<number | null> {
    const client = await this.getClient();
    const { OrderSide } = await import("@polymarket/client");
    return nullableNumber(
      await client.fetchPrice({ tokenId, side: OrderSide.BUY }),
    );
  }

  async fetchSpread(tokenId: string): Promise<number | null> {
    const client = await this.getClient();
    return nullableNumber(await client.fetchSpread({ tokenId }));
  }

  private async getClient(): Promise<PublicClient> {
    this.client ??= (await import("@polymarket/client")).createPublicClient();
    return this.client;
  }
}

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
  resolutionRules: string | null;
};

type PolymarketBook = {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
};

const POLYMARKET_LIQUIDITY_SCORE_FULL_USD = 500_000;
const POLYMARKET_LOW_LIQUIDITY_WARNING_USD = 1_000;
const POLYMARKET_SEARCH_RESULTS_FOR_AI_LIMIT = 50;

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
    const results = await Promise.all(
      this.providers.map((provider) => provider.findCandidates(input)),
    );
    return results.flat();
  }
}

export class HyperliquidMarketDataProvider implements MarketDataProvider {
  constructor(private readonly endpoint = "https://api.hyperliquid.xyz/info") {}

  async findCandidates(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate[]> {
    const exactSymbolAnchors = hyperliquidExactSymbolTokens(
      input.thesis,
      input.tradeExpression,
    );
    if (exactSymbolAnchors.length === 0) return [];

    const liveMatches = await this.findLiveAssetMatches(
      input,
      exactSymbolAnchors,
    );
    const candidates = await Promise.all(
      liveMatches.map((match) =>
        this.marketCandidateFromLiveAsset({
          ...match,
          thesis: input.thesis,
        }),
      ),
    );
    return candidates.filter((candidate): candidate is MarketCandidate =>
      Boolean(candidate),
    );
  }

  private async getPerpDexs(): Promise<HyperliquidPerpDexs> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "perpDexs" }),
    });

    return readJsonResponse<HyperliquidPerpDexs>(
      "Hyperliquid perp dex discovery",
      response,
    );
  }

  private async getMetaAndAssetCtxs(
    dex?: string | null,
  ): Promise<HyperliquidMetaAndCtxs> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "metaAndAssetCtxs",
        ...(dex ? { dex } : {}),
      }),
    });

    return readJsonResponse<HyperliquidMetaAndCtxs>(
      "Hyperliquid market data",
      response,
    );
  }

  private async getSpotMetaAndAssetCtxs(): Promise<HyperliquidSpotMetaAndCtxs> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
    });

    return readJsonResponse<HyperliquidSpotMetaAndCtxs>(
      "Hyperliquid spot market data",
      response,
    );
  }

  private async findLiveAssetMatches(
    input: {
      thesis: Thesis;
      tradeExpression?: TradeExpressionPlan;
    },
    exactSymbolAnchors: string[],
  ): Promise<HyperliquidLiveAssetMatch[]> {
    const normalizedAnchors =
      normalizedHyperliquidSymbolAnchors(exactSymbolAnchors);
    const [perpDexs, spotMetaAndCtxs] = await Promise.all([
      this.getPerpDexs(),
      this.getSpotMetaAndAssetCtxs(),
    ]);
    const dexes = uniqueHyperliquidDexes(perpDexs);
    const liveMetas = await Promise.all(
      dexes.map(async (dex) => ({
        dex,
        data: await this.getMetaAndAssetCtxs(dex),
      })),
    );
    const matches: HyperliquidLiveAssetMatch[] = [];
    const seen = new Set<string>();

    for (const {
      dex,
      data: [meta, ctxs],
    } of liveMetas) {
      if (!isHyperliquidUsdcCollateralMeta(meta)) continue;

      for (const [index, asset] of meta.universe.entries()) {
        if (!hyperliquidAssetMatchesExactAnchors(asset.name, normalizedAnchors))
          continue;

        const key = `${dex ?? "main"}:${asset.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({
          kind: "perp",
          symbol: asset.name,
          bookCoin: asset.name,
          sizeDecimals: asset.szDecimals ?? 6,
          ctx: ctxs[index],
          instrument: hyperliquidInstrumentForLiveAsset(
            dex,
            input.tradeExpression,
          ),
          reasonAssetName: asset.name,
          tradeExpression: input.tradeExpression,
        });
      }
    }

    const [spotMeta, spotCtxs] = spotMetaAndCtxs;
    const tokensByIndex = new Map(
      spotMeta.tokens.map((token) => [token.index, token]),
    );
    for (const market of spotMeta.universe) {
      const baseToken = tokensByIndex.get(market.tokens[0]!);
      const quoteToken = tokensByIndex.get(market.tokens[1]!);
      if (!baseToken || !quoteToken) continue;
      if (
        !hyperliquidSpotMarketMatchesExactAnchors(
          market,
          baseToken,
          quoteToken,
          normalizedAnchors,
        )
      )
        continue;

      const key = `spot:${market.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const symbol = hyperliquidSpotSymbol(baseToken, quoteToken);
      matches.push({
        kind: "spot",
        symbol,
        bookCoin: market.name,
        sizeDecimals: baseToken.szDecimals,
        ctx: spotCtxs[market.index],
        instrument: "spot",
        reasonAssetName: `${baseToken.name} spot`,
        tradeExpression: input.tradeExpression,
      });
    }

    return matches;
  }

  private async marketCandidateFromLiveAsset(input: {
    kind: "perp" | "spot";
    symbol: string;
    bookCoin: string;
    sizeDecimals: number;
    ctx?: HyperliquidAssetCtx;
    instrument: string;
    reasonAssetName: string;
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate | null> {
    const side =
      hyperliquidSideFromTradeExpression({
        tradeExpression: input.tradeExpression,
        symbol: input.symbol,
        reasonAssetName: input.reasonAssetName,
        kind: input.kind,
      }) ?? hyperliquidSideFromThesis(input.thesis, input.kind);
    if (!side) {
      return null;
    }

    const volume = Number(input.ctx?.dayNtlVlm ?? 0);
    const book = await this.getL2Book(input.bookCoin);
    const bookMetrics = orderBookMetrics(
      book.levels?.[0] ?? [],
      book.levels?.[1] ?? [],
    );

    if (!bookMetrics) {
      return null;
    }
    const minLotNotionalUsd = bookMetrics.mid
      ? bookMetrics.mid * 10 ** -input.sizeDecimals
      : 0;

    return {
      venue: "hyperliquid",
      instrument: input.instrument,
      side,
      symbol: input.symbol,
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
      markPrice:
        Number(
          input.ctx?.markPx ?? input.ctx?.midPx ?? bookMetrics?.mid ?? 0,
        ) || null,
      liquidityScore: Math.min(1, volume / 50_000_000),
      spreadBps: bookMetrics.spreadBps,
      estimatedSlippageBps: bookMetrics.estimatedSlippageBps,
      minOrderSizeUsd: Math.max(10, minLotNotionalUsd),
      thesisFit: input.thesis.confidence,
      reason: `${input.reasonAssetName} ${input.instrument} was found in live Hyperliquid metadata and directly maps to the thesis asset.`,
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

function hyperliquidExactSymbolTokens(
  thesis: Thesis,
  tradeExpression?: TradeExpressionPlan,
): string[] {
  const anchors = tradeExpression
    ? [
        ...exactSymbolAnchorCandidates(tradeExpression.directAsset),
        ...explicitHyperliquidInstructionSymbolAnchors(
          tradeExpression.marketRouterInstructions,
        ),
        ...(tradeExpression.candidateExpressions.flatMap((candidate) => [
          isConfiguredDirectVenueExpressionRail(candidate.expressionRail) &&
          isDirectEnoughForConfiguredVenueSearch(candidate.directness)
            ? candidate.primaryEntityOrEvent
            : null,
          ...(isConfiguredDirectVenueExpressionRail(candidate.expressionRail) &&
          isDirectEnoughForConfiguredVenueSearch(candidate.directness)
            ? exactSymbolAnchorCandidates(candidate.abstractMarket)
            : []),
          ...(isConfiguredDirectVenueExpressionRail(candidate.expressionRail) &&
          isDirectEnoughForConfiguredVenueSearch(candidate.directness)
            ? candidate.searchTerms
            : []),
        ]) ?? []),
      ]
    : thesis.mentionedAssets;

  return anchors
    .filter((value): value is string => Boolean(value))
    .filter(isExactSymbolAnchor);
}

function exactSymbolAnchorCandidates(value: string | null): string[] {
  if (!value) return [];
  return [value, ...value.split(/[^a-z0-9:_-]+/iu)];
}

function explicitHyperliquidInstructionSymbolAnchors(
  value: string | null,
): string[] {
  if (!value) return [];
  return value
    .split(/[^a-zA-Z0-9:_$-]+/u)
    .map((token) => token.trim())
    .filter(
      (token) => token.startsWith("$") || /^[A-Z0-9:_-]{2,}$/u.test(token),
    );
}

function isExactSymbolAnchor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("unknown") ||
    normalized.includes("proxy") ||
    HYPERLIQUID_GENERIC_SYMBOL_ANCHORS.has(normalized)
  )
    return false;
  return /^[a-z0-9:_/-]+$/i.test(value.trim());
}

const HYPERLIQUID_GENERIC_SYMBOL_ANCHORS = new Set([
  "perp",
  "perps",
  "pre",
  "stock",
  "stocks",
  "spot",
  "synthetic",
  "market",
  "markets",
  "trade",
  "trading",
]);

function uniqueHyperliquidDexes(
  perpDexs: HyperliquidPerpDexs,
): Array<string | null> {
  const dexes = [
    null,
    ...perpDexs
      .map((dex) => dex?.name ?? null)
      .filter((name): name is string => Boolean(name)),
  ];
  const seen = new Set<string>();
  return dexes.filter((dex) => {
    const key = dex ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedHyperliquidSymbolAnchors(
  exactSymbolAnchors: string[],
): Set<string> {
  return new Set(
    exactSymbolAnchors.map(normalizeHyperliquidSymbolAnchor).filter(Boolean),
  );
}

function hyperliquidAssetMatchesExactAnchors(
  assetName: string,
  normalizedAnchors: Set<string>,
): boolean {
  const symbolCandidates = [assetName, hyperliquidBaseSymbol(assetName)].map(
    normalizeHyperliquidSymbolAnchor,
  );

  return symbolCandidates.some((symbol) => normalizedAnchors.has(symbol));
}

function isHyperliquidUsdcCollateralMeta(
  meta: HyperliquidMetaAndCtxs[0],
): boolean {
  return (meta.collateralToken ?? 0) === 0;
}

function hyperliquidSpotMarketMatchesExactAnchors(
  market: HyperliquidSpotUniverseAsset,
  baseToken: HyperliquidSpotToken,
  quoteToken: HyperliquidSpotToken,
  normalizedAnchors: Set<string>,
): boolean {
  const symbol = hyperliquidSpotSymbol(baseToken, quoteToken);
  const candidates = [
    market.name,
    symbol,
    baseToken.name,
    quoteToken.name,
    baseToken.fullName ?? "",
    ...hyperliquidMetadataWords(baseToken.fullName),
  ].flatMap(hyperliquidSymbolVariants);

  return candidates.some((candidate) => normalizedAnchors.has(candidate));
}

function normalizeHyperliquidSymbolAnchor(value: string): string {
  return value
    .trim()
    .replace(/^\$/u, "")
    .replace(/-perp$/iu, "")
    .replace(/[^a-z0-9]/giu, "")
    .toLowerCase();
}

function hyperliquidSymbolVariants(value: string): string[] {
  const normalized = normalizeHyperliquidSymbolAnchor(value);
  if (!normalized) return [];
  const variants = [normalized];
  if (normalized.endsWith("0")) {
    variants.push(normalized.slice(0, -1));
  }
  return variants;
}

function hyperliquidMetadataWords(value: string | null): string[] {
  return value?.split(/[^a-z0-9]+/iu).filter(Boolean) ?? [];
}

function hyperliquidSpotSymbol(
  baseToken: HyperliquidSpotToken,
  quoteToken: HyperliquidSpotToken,
): string {
  return `${baseToken.name}/${quoteToken.name}`;
}

function hyperliquidBaseSymbol(value: string): string {
  return (value.split(":").at(-1) ?? value).split("/")[0]!.split("-")[0]!;
}

function hyperliquidInstrumentForLiveAsset(
  dex: string | null,
  tradeExpression?: TradeExpressionPlan,
): string {
  if (!dex) return "perp";
  if (
    tradeExpression?.candidateExpressions.some(
      (candidate) => candidate.expressionRail === "pre_ipo",
    )
  )
    return "pre_stock_perp";
  return "synthetic_perp";
}

function hyperliquidSideFromThesis(
  thesis: Thesis,
  kind: "perp" | "spot",
): "long" | "short" | "buy" | "sell" | null {
  if (kind === "spot") {
    if (thesis.direction === "bullish") return "buy";
    if (thesis.direction === "bearish") return "sell";
    return null;
  }
  if (thesis.direction === "bullish") return "long";
  if (thesis.direction === "bearish") return "short";
  return null;
}

function hyperliquidSideFromTradeExpression(input: {
  tradeExpression?: TradeExpressionPlan;
  symbol: string;
  reasonAssetName: string;
  kind: "perp" | "spot";
}): "long" | "short" | "buy" | "sell" | null {
  const expression = input.tradeExpression?.candidateExpressions.find(
    (candidate) => {
      if (!isConfiguredDirectVenueExpressionRail(candidate.expressionRail))
        return false;
      if (!isDirectEnoughForConfiguredVenueSearch(candidate.directness))
        return false;
      if (
        candidate.intendedSide !== "long" &&
        candidate.intendedSide !== "short"
      )
        return false;
      return hyperliquidCandidateExpressionMatchesSymbol(
        candidate,
        input.symbol,
        input.reasonAssetName,
      );
    },
  );

  if (!expression) return null;
  const side = expression.intendedSide === "long" ? "long" : "short";
  if (input.kind === "spot") {
    return side === "long" ? "buy" : "sell";
  }
  return side;
}

function hyperliquidCandidateExpressionMatchesSymbol(
  candidate: TradeExpressionPlan["candidateExpressions"][number],
  symbol: string,
  reasonAssetName: string,
): boolean {
  const symbolVariants = new Set(
    [
      symbol,
      reasonAssetName,
      hyperliquidBaseSymbol(symbol),
      hyperliquidBaseSymbol(reasonAssetName),
      ...hyperliquidMetadataWords(reasonAssetName),
    ].flatMap(hyperliquidSymbolVariants),
  );

  return [
    candidate.primaryEntityOrEvent,
    candidate.abstractMarket,
    ...candidate.searchTerms,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, ...hyperliquidMetadataWords(value)])
    .flatMap(hyperliquidSymbolVariants)
    .some((anchor) => symbolVariants.has(anchor));
}

export class PolymarketMarketDataProvider
  implements MarketDataProvider, PolymarketMarketFinder
{
  constructor(
    private readonly searchClient: PolymarketSearchClient = new PolymarketSdkSearchClient(),
    private readonly queryPlanner?: PolymarketDiscoveryQueryPlanner,
    private readonly searchResultSelector?: PolymarketSearchResultSelector,
  ) {}

  async findCandidates(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
  }): Promise<MarketCandidate[]> {
    return this.findPolymarketMarkets(input);
  }

  async findPolymarketMarkets(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    limit?: number;
  }): Promise<MarketCandidate[]> {
    if (!this.queryPlanner) {
      throw new MissingConnectorConfigError(
        "Polymarket semantic discovery",
        "AiPolymarketDiscoveryQueryPlanner",
      );
    }
    if (!this.searchResultSelector) {
      throw new MissingConnectorConfigError(
        "Polymarket semantic result selection",
        "AiPolymarketSearchResultSelector",
      );
    }

    const limit = input.limit ?? 10;
    const queries = await this.queryPlanner.planPolymarketSearchQueries(input);
    const marketResponses = await Promise.all(
      queries.map((query) =>
        this.searchClient.searchMarkets(query, Math.max(limit, 10)),
      ),
    );
    const markets = await this.selectMatchingPolymarketMarkets({
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
      markets: uniquePolymarketMarkets(marketResponses.flat()),
      limit,
    });

    const candidates = await Promise.all(
      markets
        .filter((market) => market.active !== false && market.closed !== true)
        .map(async (market): Promise<MarketCandidate | null> => {
          const outcome = polymarketOutcomeForTradeExpression(
            input.tradeExpression,
            input.thesis,
          );
          const buyNo = outcome === "no";
          const normalized = normalizePolymarketMarket(market);
          const outcomeTokenId = normalized.tokenIds[buyNo ? 1 : 0] ?? null;
          const heldPrice =
            outcome === "no" ? normalized.noPrice : normalized.yesPrice;
          if (!outcomeTokenId) {
            throw new Error(
              `Polymarket market ${market.slug ?? market.id ?? market.question ?? "unknown"} has no outcome token id.`,
            );
          }

          const book = await this.getBook(outcomeTokenId);
          const metrics = orderBookMetrics(book.bids ?? [], book.asks ?? []);

          if (!metrics) {
            return null;
          }

          const warnings = polymarketWarnings(normalized);

          return {
            venue: "polymarket",
            instrument: normalized.slug,
            side: outcome === "no" ? ("buy_no" as const) : ("buy_yes" as const),
            symbol: normalized.slug,
            conditionId: normalized.conditionId,
            outcomeTokenId,
            yesOutcomeTokenId: normalized.tokenIds[0] ?? null,
            noOutcomeTokenId: normalized.tokenIds[1] ?? null,
            marketQuestion: normalized.question,
            marketSlug: normalized.slug,
            resolutionRules: normalized.resolutionRules,
            outcome,
            yesPrice: normalized.yesPrice,
            noPrice: normalized.noPrice,
            heldSidePrice: metrics.mid ?? heldPrice,
            volumeUsd: normalized.volumeUsd,
            liquidityUsd: normalized.liquidityUsd,
            endDate: normalized.endDate,
            markPrice:
              metrics.mid ?? (heldPrice && heldPrice > 0 ? heldPrice : null),
            liquidityScore: Math.min(
              1,
              Math.max(normalized.liquidityUsd, normalized.volumeUsd) /
                POLYMARKET_LIQUIDITY_SCORE_FULL_USD,
            ),
            spreadBps: metrics.spreadBps,
            estimatedSlippageBps: metrics.estimatedSlippageBps,
            minOrderSizeUsd: 1,
            thesisFit: input.thesis.confidence,
            reason: normalized.question,
            warnings,
          };
        }),
    );

    return candidates.filter(
      (candidate): candidate is MarketCandidate =>
        candidate !== null && candidate.spreadBps > 0,
    );
  }

  private async selectMatchingPolymarketMarkets(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    markets: PolymarketMarket[];
    limit: number;
  }): Promise<PolymarketMarket[]> {
    const activeMarkets = input.markets.filter(
      (market) => market.active !== false && market.closed !== true,
    );
    const selectableMarkets = activeMarkets.flatMap(
      (market): PolymarketSearchResultForSelection[] => {
        const slug = market.slug ?? "";
        const question = market.question ?? "";
        if (!slug || !question) return [];
        return [
          {
            slug,
            question,
            active: market.active,
            closed: market.closed,
            endDate: market.endDate,
            resolutionRules: polymarketResolutionRules(market),
            outcomes: market.outcomes,
            outcomePrices: market.outcomePrices,
            liquidityUsd: nullableNumber(market.liquidityNum),
            volumeUsd: nullableNumber(market.volumeNum),
          },
        ];
      },
    );
    if (selectableMarkets.length === 0) return [];

    const selectedSlugs =
      await this.searchResultSelector!.selectPolymarketSearchResults({
        thesis: input.thesis,
        tradeExpression: input.tradeExpression,
        markets: rankPolymarketSearchResultsForAi({
          thesis: input.thesis,
          tradeExpression: input.tradeExpression,
          markets: selectableMarkets,
        }).slice(0, POLYMARKET_SEARCH_RESULTS_FOR_AI_LIMIT),
        limit: input.limit,
      });
    const selectedSlugSet = new Set(selectedSlugs);
    return activeMarkets
      .filter(
        (market) =>
          typeof market.slug === "string" && selectedSlugSet.has(market.slug),
      )
      .sort(
        (a, b) =>
          selectedSlugs.indexOf(a.slug ?? "") -
          selectedSlugs.indexOf(b.slug ?? ""),
      )
      .slice(0, input.limit);
  }

  async assessPolymarketMarket(input: {
    thesis: Thesis;
    tradeExpression?: TradeExpressionPlan;
    market: {
      conditionId?: string | null;
      marketSlug?: string | null;
      question?: string | null;
    };
    side: "yes" | "no";
  }): Promise<PolymarketMarketAssessment> {
    const candidates = await this.findPolymarketMarkets({
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
      limit: 20,
    });
    const candidate = candidates.find((item) => {
      if (
        input.market.conditionId &&
        item.conditionId === input.market.conditionId
      )
        return true;
      if (
        input.market.marketSlug &&
        item.marketSlug === input.market.marketSlug
      )
        return true;
      if (
        input.market.question &&
        item.marketQuestion === input.market.question
      )
        return true;
      return false;
    });

    if (!candidate) {
      throw new Error(
        "Polymarket assessment could not find the requested market in live discovery results.",
      );
    }

    const wantsNo = input.side === "no";
    const trade =
      candidate.side === (wantsNo ? "buy_no" : "buy_yes")
        ? candidate
        : await this.flipPolymarketCandidateSide(candidate, input.side);

    if (
      !trade.conditionId ||
      !trade.outcomeTokenId ||
      !trade.marketQuestion ||
      !trade.marketSlug ||
      !trade.outcome ||
      trade.yesPrice == null ||
      trade.noPrice == null ||
      trade.heldSidePrice == null
    ) {
      throw new Error(
        "Polymarket assessment requires condition_id, outcome token, question, slug, outcome, and normalized prices.",
      );
    }

    const warnings = Array.from(new Set([...(trade.warnings ?? [])]));
    return {
      fit:
        trade.thesisFit >= 0.7
          ? "strong"
          : trade.thesisFit >= 0.4
            ? "weak"
            : "no_fit",
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
    const [book, buyPrice, quotedSpread] = await Promise.all([
      this.getBook(input.outcomeTokenId),
      this.searchClient.fetchBuyPrice(input.outcomeTokenId),
      this.searchClient.fetchSpread(input.outcomeTokenId),
    ]);
    const metrics = orderBookMetrics(book.bids ?? [], book.asks ?? []);
    if (!metrics) {
      throw new Error(
        `Polymarket order book is empty for token ${input.outcomeTokenId}.`,
      );
    }
    const heldSidePrice = buyPrice ?? metrics.mid;

    return {
      conditionId: input.conditionId ?? null,
      outcomeTokenId: input.outcomeTokenId,
      outcome: input.side,
      yesPrice: input.side === "yes" ? heldSidePrice : (input.yesPrice ?? null),
      noPrice: input.side === "no" ? heldSidePrice : (input.noPrice ?? null),
      heldSidePrice,
      bid: metrics.bid,
      ask: metrics.ask,
      midPrice: metrics.mid,
      spreadBps: quotedSpread ? quotedSpread * 10_000 : metrics.spreadBps,
      timestamp: new Date().toISOString(),
    };
  }

  private async flipPolymarketCandidateSide(
    candidate: MarketCandidate,
    side: "yes" | "no",
  ): Promise<MarketCandidate> {
    const outcomeTokenId =
      side === "yes" ? candidate.yesOutcomeTokenId : candidate.noOutcomeTokenId;
    if (!outcomeTokenId) {
      throw new Error(
        "Cannot flip a Polymarket candidate without both outcome token IDs from discovery.",
      );
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
    return this.searchClient.fetchOrderBook(tokenId);
  }
}

function rankPolymarketSearchResultsForAi(input: {
  thesis: Thesis;
  tradeExpression?: TradeExpressionPlan;
  markets: PolymarketSearchResultForSelection[];
}): PolymarketSearchResultForSelection[] {
  const relevanceTerms = polymarketSearchRelevanceTerms(
    input.thesis,
    input.tradeExpression,
  );
  return input.markets
    .map((market, index) => ({
      market,
      index,
      score: polymarketSearchResultScore(market, relevanceTerms),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((ranked) => ranked.market);
}

function polymarketSearchResultScore(
  market: PolymarketSearchResultForSelection,
  relevanceTerms: Set<string>,
): number {
  const searchable =
    `${market.slug} ${market.question} ${market.resolutionRules ?? ""}`.toLowerCase();
  let score = 0;
  for (const term of relevanceTerms) {
    if (searchable.includes(term)) score += term.length >= 5 ? 20 : 10;
  }
  if (market.endDate) score += 5;
  score += Math.log10(Math.max(0, market.liquidityUsd ?? 0) + 1) * 3;
  score += Math.log10(Math.max(0, market.volumeUsd ?? 0) + 1) * 2;
  return score;
}

function polymarketSearchRelevanceTerms(
  thesis: Thesis,
  tradeExpression?: TradeExpressionPlan,
): Set<string> {
  return new Set(
    [
      thesis.claim,
      ...thesis.mentionedAssets,
      ...thesis.topics,
      tradeExpression?.directAsset ?? null,
      ...(tradeExpression?.candidateExpressions.flatMap((candidate) => [
        candidate.primaryEntityOrEvent,
        candidate.abstractMarket,
        ...candidate.searchTerms,
      ]) ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/u))
      .filter((term) => term.length >= 3),
  );
}

function orderBookMetrics(
  bids: Array<{ px?: string; price?: string; sz?: string; size?: string }>,
  asks: Array<{ px?: string; price?: string; sz?: string; size?: string }>,
) {
  const bid = topBid(bids);
  const ask = topAsk(asks);

  if (!bid || !ask || bid <= 0 || ask <= 0) {
    return null;
  }

  const mid = (bid + ask) / 2;
  const spreadBps = Math.round(((ask - bid) / mid) * 10_000);
  const estimatedSlippageBps = estimateBuySlippageBps(asks, 50, ask);
  return { bid, ask, mid, spreadBps, estimatedSlippageBps };
}

function topBid(bids: Array<{ px?: string; price?: string }>): number | null {
  return topPrice(bids, Math.max);
}

function topAsk(asks: Array<{ px?: string; price?: string }>): number | null {
  return topPrice(asks, Math.min);
}

function topPrice(
  levels: Array<{ px?: string; price?: string }>,
  select: (current: number, candidate: number) => number,
): number | null {
  let best: number | null = null;

  for (const level of levels) {
    const price = Number(level.px ?? level.price);
    if (!Number.isFinite(price)) continue;
    best = best == null ? price : select(best, price);
  }

  return best;
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
    if (
      !Number.isFinite(price) ||
      !Number.isFinite(size) ||
      price <= 0 ||
      size <= 0
    )
      continue;
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

function parseStringArray(
  value: string | string[] | undefined,
  context: { field: string; market: string },
): string[] {
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

  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw malformedPolymarketStringArrayError(context);
  }

  return parsed;
}

function parseNumberArray(
  value: string | string[] | undefined,
  context: { field: string; market: string },
): number[] {
  const items = Array.isArray(value) ? value : parseJsonArray(value, context);

  return items
    .filter((item) => item !== null)
    .map((item) => {
      if (typeof item !== "string" && typeof item !== "number") {
        throw malformedPolymarketNumberArrayError(context);
      }
      if (typeof item === "string" && item.trim() === "") {
        throw malformedPolymarketNumberArrayError(context);
      }
      const parsed = Number(item);
      if (!Number.isFinite(parsed)) {
        throw malformedPolymarketNumberArrayError(context);
      }
      return parsed;
    });
}

function parseJsonArray(
  value: string | undefined,
  context: { field: string; market: string },
): unknown[] {
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw malformedPolymarketStringArrayError(context, error);
  }

  if (!Array.isArray(parsed)) {
    throw malformedPolymarketStringArrayError(context);
  }

  return parsed;
}

function malformedPolymarketStringArrayError(
  context: { field: string; market: string },
  cause?: unknown,
): Error {
  const causeMessage = cause instanceof Error ? ` ${cause.message}` : "";
  return new Error(
    `Malformed Polymarket provider field ${context.field} for market ${context.market}. Expected a JSON array of strings or string[].${causeMessage}`,
  );
}

function malformedPolymarketNumberArrayError(context: {
  field: string;
  market: string;
}): Error {
  return new Error(
    `Malformed Polymarket provider field ${context.field} for market ${context.market}. Expected a JSON array of numeric strings or numbers.`,
  );
}

function polymarketBookFromSdkBook(book: OrderBook): PolymarketBook {
  return {
    bids:
      book.bids?.map((level) => ({
        price: String(level.price),
        size: String(level.size),
      })) ?? [],
    asks:
      book.asks?.map((level) => ({
        price: String(level.price),
        size: String(level.size),
      })) ?? [],
  };
}

function nullableNumber(
  value: string | number | null | undefined,
): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePolymarketMarket(
  market: PolymarketMarket,
): NormalizedPolymarketMarket {
  const slug = market.slug ?? market.id ?? market.question;
  if (!slug) {
    throw new Error("Polymarket market is missing a slug.");
  }
  if (!market.conditionId) {
    throw new Error(`Polymarket market ${slug} is missing condition_id.`);
  }

  const tokenIds = parseStringArray(market.clobTokenIds, {
    field: "clobTokenIds",
    market: slug,
  });
  const prices = parseNumberArray(market.outcomePrices, {
    field: "outcomePrices",
    market: slug,
  });
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
    resolutionRules: polymarketResolutionRules(market),
  };
}

function polymarketResolutionRules(market: PolymarketMarket): string | null {
  const text = [
    market.description,
    market.resolutionSource
      ? `Resolution source: ${market.resolutionSource}`
      : null,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.trim())
    .join("\n\n");
  return text.length > 0 ? text : null;
}

function polymarketWarnings(market: NormalizedPolymarketMarket): string[] {
  const warnings: string[] = [];
  if (market.liquidityUsd < POLYMARKET_LOW_LIQUIDITY_WARNING_USD) {
    warnings.push("liquidity_under_1000");
  }
  if (!market.endDate) {
    warnings.push("missing_resolution_date");
  }
  return warnings;
}

function uniquePolymarketMarkets(
  markets: PolymarketMarket[],
): PolymarketMarket[] {
  const seen = new Set<string>();
  const unique: PolymarketMarket[] = [];

  for (const market of markets) {
    const key =
      market.conditionId ?? market.slug ?? market.id ?? market.question;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(market);
  }

  return unique;
}

function polymarketOutcomeForTradeExpression(
  tradeExpression: TradeExpressionPlan | undefined,
  thesis: Thesis,
): "yes" | "no" {
  const expressionSide = tradeExpression?.candidateExpressions.find(
    (candidate) =>
      candidate.expressionRail === "prediction_market" &&
      candidate.intendedSide !== "avoid" &&
      candidate.directness === "direct",
  )?.intendedSide;

  if (expressionSide === "yes" || expressionSide === "no")
    return expressionSide;
  return thesis.direction === "bearish" ? "no" : "yes";
}
