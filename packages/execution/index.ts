import type {
  ExecutionFundingSource,
  ExecutionJob,
  Position,
  TradeTicket,
} from "../core/schemas/index.ts";
import { MissingConnectorConfigError } from "../core/helpers/connector-errors.ts";
import {
  assertHyperliquidExecutionEnv,
  assertPolymarketExecutionEnv,
  readHyperliquidExecutionEnv,
  readPolymarketExecutionEnv,
  type HyperliquidExecutionEnv,
  type HyperliquidExecutionEnvOptions,
  type PolymarketExecutionEnv,
  type PolymarketExecutionEnvOptions,
  type RequiredHyperliquidExecutionEnv,
  type RequiredPolymarketExecutionEnv,
} from "../core/config.ts";
import type {
  OrderResponse,
  OrderSide,
  OrderType,
  SecureClient,
} from "@polymarket/client";
import { Wallet as EthersWallet } from "ethers";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatDecimal, formatHyperliquidPrice } from "./helpers/format.ts";

export interface ExecutionClient {
  execute(
    ticket: TradeTicket,
    context?: ExecutionContext,
  ): Promise<NonNullable<ExecutionJob["executionResult"]>>;
}

export interface PositionCloseClient {
  close(
    position: Position,
    ticket: TradeTicket,
  ): Promise<NonNullable<ExecutionJob["executionResult"]>>;
}

export type ExecutionContext = {
  funding?: ExecutionFundingSource;
};

export class VenueExecutionClient implements ExecutionClient {
  constructor(
    private readonly hyperliquid = new HyperliquidExecutionClient(),
    private readonly polymarket = new PolymarketExecutionClient(),
  ) {}

  async execute(
    ticket: TradeTicket,
    context: ExecutionContext = {},
  ): Promise<NonNullable<ExecutionJob["executionResult"]>> {
    if (ticket.venue === "hyperliquid") {
      return this.hyperliquid.execute(ticket, context);
    }

    if (ticket.venue === "polymarket") {
      return this.polymarket.execute(ticket);
    }

    throw new MissingConnectorConfigError(
      `Execution venue ${ticket.venue}`,
      "SUPPORTED_EXECUTION_VENUE",
    );
  }
}

type HyperliquidInfoClientLike = Pick<
  InfoClient,
  "allMids" | "metaAndAssetCtxs" | "perpDexs" | "spotMetaAndAssetCtxs"
>;
type HyperliquidExchangeClientLike = Pick<ExchangeClient, "order">;
type ResolvedHyperliquidAsset = {
  id: number;
  sizeDecimals: number;
  maxLeverage?: number;
  midKey: string;
  midPx?: string;
  isSpot: boolean;
  dex?: string | null;
  onlyIsolated?: boolean;
};
type HyperliquidExecutionClients = {
  info: HyperliquidInfoClientLike;
  exchange: HyperliquidExchangeClientLike &
    Pick<ExchangeClient, "updateLeverage">;
  mainExchange?: HyperliquidExchangeClientLike &
    Pick<ExchangeClient, "updateLeverage">;
};
type HyperliquidExecutionClientFactory = (
  config: RequiredHyperliquidExecutionEnv,
) => HyperliquidExecutionClients | Promise<HyperliquidExecutionClients>;
const HYPERLIQUID_STRICT_ISOLATED_MIN_MARGIN_USD = 5;
export type HyperliquidExecutionClientOptions =
  HyperliquidExecutionEnvOptions & {
    clientFactory?: HyperliquidExecutionClientFactory;
  };

export class HyperliquidExecutionClient implements ExecutionClient {
  private readonly config: HyperliquidExecutionEnv;
  private readonly clientFactory: HyperliquidExecutionClientFactory;

  constructor(options: HyperliquidExecutionClientOptions = {}) {
    this.config = readHyperliquidExecutionEnv(undefined, options);
    this.clientFactory =
      options.clientFactory ?? createHyperliquidExecutionClients;
  }

  async execute(
    ticket: TradeTicket,
    _context: ExecutionContext = {},
  ): Promise<NonNullable<ExecutionJob["executionResult"]>> {
    const config = assertHyperliquidExecutionEnv(this.config);
    const clients = await this.clientFactory(config);
    const { info } = clients;
    const symbol =
      ticket.venueData?.symbol ?? ticket.instrument.replace("-PERP", "");
    const asset = await this.resolveAsset(info, ticket, symbol);
    const executionExchange = hyperliquidOrderExchangeForAsset(
      clients,
      asset,
      symbol,
    );
    const mids = await info.allMids();
    const mid = Number(mids[asset.midKey] ?? asset.midPx);

    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`No Hyperliquid mid price for ${symbol}.`);
    }

    const isBuy = ticket.side === "long" || ticket.side === "buy";
    const slippage = config.slippageBps / 10_000;
    const price = isBuy ? mid * (1 + slippage) : mid * (1 - slippage);
    const leverage = asset.isSpot ? 1 : config.perpLeverage;
    if (!asset.isSpot) {
      if (asset.maxLeverage != null && leverage > asset.maxLeverage) {
        throw new Error(
          `Hyperliquid ${symbol} max leverage is ${asset.maxLeverage}x; configured leverage is ${leverage}x.`,
        );
      }
      await executionExchange.updateLeverage({
        asset: asset.id,
        isCross: !asset.onlyIsolated,
        leverage,
      });
    }
    const requestedSizeUsd = ticket.sizeUsd * leverage;
    const size = requestedSizeUsd / mid;
    const requestedSize = formatDecimal(size, asset.sizeDecimals);
    if (Number(requestedSize) <= 0) {
      throw new Error(
        `Hyperliquid order size rounds to zero for ${symbol}; increase ticket size.`,
      );
    }
    if (asset.dex && asset.onlyIsolated) {
      assertHyperliquidStrictIsolatedMargin({
        symbol,
        requestedSize,
        mid,
        leverage,
        sizeDecimals: asset.sizeDecimals,
      });
    }
    const response = await executionExchange.order({
      orders: [
        {
          a: asset.id,
          b: isBuy,
          p: formatHyperliquidPrice(
            price,
            asset.sizeDecimals,
            asset.isSpot ? 8 : 6,
            config.priceDecimals,
          ),
          s: requestedSize,
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    });
    const executionResult = parseHyperliquidOrderExecution(response, {
      requestedSize,
      requestedSizeUsd,
      collateralUsd: ticket.sizeUsd,
      leverage,
    });

    return {
      ...executionResult,
      raw: response,
    };
  }

  private async resolveAsset(
    info: HyperliquidInfoClientLike,
    ticket: TradeTicket,
    symbol: string,
  ): Promise<ResolvedHyperliquidAsset> {
    if (isHyperliquidSpotTicket(ticket)) {
      return this.resolveSpotAsset(info, symbol);
    }
    return this.resolvePerpAsset(info, symbol);
  }

  private async resolvePerpAsset(
    info: HyperliquidInfoClientLike,
    symbol: string,
  ): Promise<ResolvedHyperliquidAsset> {
    return resolveHyperliquidPerpAsset(info, symbol);
  }

  private async resolveSpotAsset(
    info: HyperliquidInfoClientLike,
    symbol: string,
  ): Promise<ResolvedHyperliquidAsset> {
    return resolveHyperliquidSpotAsset(info, symbol);
  }
}

export class HyperliquidPositionCloseClient implements PositionCloseClient {
  private readonly config: HyperliquidExecutionEnv;
  private readonly clientFactory: HyperliquidExecutionClientFactory;

  constructor(options: HyperliquidExecutionClientOptions = {}) {
    this.config = readHyperliquidExecutionEnv(undefined, options);
    this.clientFactory =
      options.clientFactory ?? createHyperliquidExecutionClients;
  }

  async close(
    position: Position,
    ticket: TradeTicket,
  ): Promise<NonNullable<ExecutionJob["executionResult"]>> {
    const config = assertHyperliquidExecutionEnv(this.config);
    const clients = await this.clientFactory(config);
    const { info } = clients;
    const symbol =
      ticket.venueData?.symbol ?? ticket.instrument.replace("-PERP", "");
    const asset = isHyperliquidSpotTicket(ticket)
      ? await resolveHyperliquidSpotAsset(info, symbol)
      : await resolveHyperliquidPerpAsset(info, symbol);
    const executionExchange = hyperliquidOrderExchangeForAsset(
      clients,
      asset,
      symbol,
    );
    const mids = await info.allMids();
    const mid = Number(mids[asset.midKey] ?? asset.midPx);
    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`No Hyperliquid mid price for ${symbol}.`);
    }
    const isClosingBuy = position.side === "short" || position.side === "sell";
    const slippage = config.slippageBps / 10_000;
    const price = isClosingBuy ? mid * (1 + slippage) : mid * (1 - slippage);
    if (position.filledBaseSize == null || position.filledBaseSize <= 0) {
      throw new Error(
        `Hyperliquid position ${position.positionId} is missing filledBaseSize.`,
      );
    }
    const baseSize = position.filledBaseSize;
    const requestedSize = formatDecimal(baseSize, asset.sizeDecimals);
    if (Number(requestedSize) <= 0) {
      throw new Error(`Hyperliquid close size rounds to zero for ${symbol}.`);
    }
    const response = await executionExchange.order({
      orders: [
        {
          a: asset.id,
          b: isClosingBuy,
          p: formatHyperliquidPrice(
            price,
            asset.sizeDecimals,
            asset.isSpot ? 8 : 6,
            config.priceDecimals,
          ),
          s: requestedSize,
          r: true,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    });
    return {
      ...parseHyperliquidOrderExecution(response, {
        requestedSize,
        requestedSizeUsd: position.currentValueUsd,
        collateralUsd: position.currentValueUsd,
        leverage: 1,
      }),
      raw: response,
    };
  }
}

function hyperliquidOrderExchangeForAsset(
  clients: HyperliquidExecutionClients,
  asset: ResolvedHyperliquidAsset,
  symbol: string,
): HyperliquidExecutionClients["exchange"] {
  if (asset.dex && asset.onlyIsolated) {
    if (!clients.mainExchange) {
      throw new MissingConnectorConfigError(
        `Hyperliquid strict isolated builder perp execution for ${symbol}`,
        "HYPERLIQUID_MAIN_PRIVATE_KEY",
      );
    }
    return clients.mainExchange;
  }

  return clients.exchange;
}

function assertHyperliquidStrictIsolatedMargin(input: {
  symbol: string;
  requestedSize: string;
  mid: number;
  leverage: number;
  sizeDecimals: number;
}): void {
  const roundedCollateralUsd =
    (Number(input.requestedSize) * input.mid) / input.leverage;
  if (roundedCollateralUsd >= HYPERLIQUID_STRICT_ISOLATED_MIN_MARGIN_USD)
    return;

  const minimumSize = ceilDecimal(
    (HYPERLIQUID_STRICT_ISOLATED_MIN_MARGIN_USD * input.leverage) / input.mid,
    input.sizeDecimals,
  );
  const minimumMarginUsd = (Number(minimumSize) * input.mid) / input.leverage;
  throw new Error(
    `Hyperliquid ${input.symbol} strict isolated margin rounds below $${HYPERLIQUID_STRICT_ISOLATED_MIN_MARGIN_USD}; minimum executable margin is $${formatDecimal(minimumMarginUsd, 2)} at ${input.leverage}x.`,
  );
}

function ceilDecimal(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return formatDecimal(Math.ceil(value * factor) / factor, decimals);
}

async function resolveHyperliquidPerpAsset(
  info: HyperliquidInfoClientLike,
  symbol: string,
): Promise<ResolvedHyperliquidAsset> {
  const dexes = symbol.includes(":")
    ? await uniqueHyperliquidExecutionDexes(info)
    : [{ dex: null, dexIndex: 0 }];
  for (const { dex, dexIndex } of dexes) {
    const [meta, ctxs] = await info.metaAndAssetCtxs(dex ? { dex } : undefined);
    const index = meta.universe.findIndex((asset) => asset.name === symbol);

    if (index < 0) continue;

    const ctx = ctxs[index];
    return {
      id: dex ? 100_000 + dexIndex * 10_000 + index : index,
      sizeDecimals: meta.universe[index]?.szDecimals ?? 6,
      maxLeverage: meta.universe[index]?.maxLeverage,
      midKey: symbol,
      midPx: ctx?.midPx ?? ctx?.markPx,
      isSpot: false,
      dex,
      onlyIsolated: meta.universe[index]?.onlyIsolated,
    };
  }

  throw new Error(
    `Hyperliquid asset ${symbol} was not found in live exchange metadata.`,
  );
}

async function uniqueHyperliquidExecutionDexes(
  info: HyperliquidInfoClientLike,
): Promise<Array<{ dex: string | null; dexIndex: number }>> {
  const liveDexes = (await info.perpDexs()).map((dex) => dex?.name ?? null);
  const dexes = liveDexes[0] == null ? liveDexes : [null, ...liveDexes];
  const seen = new Set<string>();
  return dexes
    .map((dex, dexIndex) => ({ dex, dexIndex }))
    .filter(({ dex }) => {
      const key = dex ?? "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function resolveHyperliquidSpotAsset(
  info: HyperliquidInfoClientLike,
  symbol: string,
): Promise<ResolvedHyperliquidAsset> {
  const [meta, ctxs] = await info.spotMetaAndAssetCtxs();
  const tokensByIndex = new Map(
    meta.tokens.map((token) => [token.index, token]),
  );
  const normalizedSymbol = normalizeHyperliquidExecutionSymbol(symbol);
  const matches = meta.universe
    .map((market) => {
      const baseToken = tokensByIndex.get(market.tokens[0]!);
      const quoteToken = tokensByIndex.get(market.tokens[1]!);
      return baseToken && quoteToken ? { market, baseToken, quoteToken } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    )
    .filter(({ market, baseToken, quoteToken }) =>
      hyperliquidExecutionSymbolVariants(
        market.name,
        baseToken.name,
        quoteToken.name,
        baseToken.fullName,
      ).has(normalizedSymbol),
    )
    .sort(
      (left, right) =>
        Number(right.quoteToken.name === "USDC") -
        Number(left.quoteToken.name === "USDC"),
    );

  const match = matches[0];
  if (!match) {
    throw new Error(
      `Hyperliquid spot asset ${symbol} was not found in live spot metadata.`,
    );
  }

  const ctx = ctxs[match.market.index];
  return {
    id: 10_000 + match.market.index,
    sizeDecimals: match.baseToken.szDecimals,
    midKey: match.market.name,
    midPx: ctx?.midPx ?? ctx?.markPx,
    isSpot: true,
  };
}

function createHyperliquidExecutionClients(
  config: RequiredHyperliquidExecutionEnv,
): HyperliquidExecutionClients {
  const wallet = new EthersWallet(config.privateKey);
  const fundingWallet = config.mainPrivateKey
    ? new EthersWallet(config.mainPrivateKey)
    : null;
  const transport = new HttpTransport();
  return {
    info: new InfoClient({ transport }),
    exchange: new ExchangeClient({ transport, wallet }),
    mainExchange: fundingWallet
      ? new ExchangeClient({ transport, wallet: fundingWallet })
      : undefined,
  };
}

function parseHyperliquidOrderExecution(
  response: Awaited<ReturnType<HyperliquidExchangeClientLike["order"]>>,
  input: {
    requestedSize: string;
    requestedSizeUsd: number;
    collateralUsd: number;
    leverage: number;
  },
): Pick<
  NonNullable<ExecutionJob["executionResult"]>,
  | "venueOrderId"
  | "filledBaseSize"
  | "filledSizeUsd"
  | "collateralUsedUsd"
  | "averagePrice"
> {
  const status = response.response.data.statuses[0];
  if (!status) {
    throw new Error(
      "Hyperliquid order response did not include an order status.",
    );
  }

  if (typeof status === "string") {
    return {
      venueOrderId: null,
      filledBaseSize: 0,
      filledSizeUsd: 0,
      collateralUsedUsd: 0,
      averagePrice: null,
    };
  }

  if ("filled" in status) {
    const filledSize = readPositiveHyperliquidNumber(
      status.filled.totalSz,
      "filled size",
    );
    const averagePrice = readPositiveHyperliquidNumber(
      status.filled.avgPx,
      "average fill price",
    );

    const filledSizeUsd = Math.min(
      input.requestedSizeUsd,
      filledSize * averagePrice,
    );
    return {
      venueOrderId: String(status.filled.oid),
      filledBaseSize: filledSize,
      filledSizeUsd,
      collateralUsedUsd: Math.min(
        input.collateralUsd,
        filledSizeUsd / input.leverage,
      ),
      averagePrice,
    };
  }

  if ("resting" in status) {
    return {
      venueOrderId: String(status.resting.oid),
      filledBaseSize: 0,
      filledSizeUsd: 0,
      collateralUsedUsd: 0,
      averagePrice: null,
    };
  }

  throw new Error(
    "Hyperliquid order response contained an unsupported order status.",
  );
}

function readPositiveHyperliquidNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid Hyperliquid ${label}: ${value}`);
  }
  return parsed;
}

function isHyperliquidSpotTicket(ticket: TradeTicket): boolean {
  return ticket.instrument === "spot" || ticket.instrument.includes("/");
}

function hyperliquidExecutionSymbolVariants(
  marketName: string,
  baseName: string,
  quoteName: string,
  baseFullName: string | null,
): Set<string> {
  const values = [
    marketName,
    baseName,
    `${baseName}/${quoteName}`,
    `${baseName}-${quoteName}`,
    baseFullName ?? "",
  ];
  const variants = values.flatMap((value) => {
    const normalized = normalizeHyperliquidExecutionSymbol(value);
    if (!normalized) return [];
    return normalized.endsWith("0")
      ? [normalized, normalized.slice(0, -1)]
      : [normalized];
  });
  return new Set(variants);
}

function normalizeHyperliquidExecutionSymbol(value: string): string {
  return value
    .trim()
    .replace(/^\$/u, "")
    .replace(/[^a-z0-9]/giu, "")
    .toLowerCase();
}

export interface PolymarketSdkTradingClientLike {
  isGaslessReady(): Promise<boolean>;
  setupGaslessWallet(): Promise<PolymarketSdkTradingClientLike>;
  placeMarketOrder(order: {
    tokenId: string;
    amount: number;
    side: OrderSide.BUY | OrderSide.SELL;
    orderType: OrderType.FAK;
    builderCode?: `0x${string}`;
  }): Promise<OrderResponse>;
}

export type PolymarketSdkTradingClientFactory = (
  config: RequiredPolymarketExecutionEnv,
) => Promise<PolymarketSdkTradingClientLike>;

export type PolymarketExecutionClientOptions = PolymarketExecutionEnvOptions & {
  factory?: PolymarketSdkTradingClientFactory;
};

export class PolymarketExecutionClient implements ExecutionClient {
  private readonly config: PolymarketExecutionEnv;
  private readonly factory: PolymarketSdkTradingClientFactory;

  constructor(options: PolymarketExecutionClientOptions = {}) {
    this.config = readPolymarketExecutionEnv(undefined, options);
    this.factory = options.factory ?? createPolymarketSdkTradingClient;
  }

  async execute(
    ticket: TradeTicket,
  ): Promise<NonNullable<ExecutionJob["executionResult"]>> {
    const config = assertPolymarketExecutionEnv(this.config);
    const tokenId = ticket.venueData?.outcomeTokenId;
    if (!tokenId || !/^\d+$/.test(tokenId)) {
      throw new Error(
        "Polymarket execution requires venueData.outcomeTokenId.",
      );
    }

    if (
      ticket.side !== "buy_no" &&
      ticket.side !== "buy_yes" &&
      ticket.side !== "buy"
    ) {
      throw new Error(
        "Polymarket execution only supports buy-side market orders.",
      );
    }

    const client = await preparePolymarketTradingClient(
      await this.factory(config),
      config,
    );
    const { OrderSide, OrderType } = await import("@polymarket/client");
    const response = await client.placeMarketOrder({
      tokenId,
      amount: ticket.sizeUsd,
      side: OrderSide.BUY,
      orderType: OrderType.FAK,
      builderCode: config.builderCode as `0x${string}` | undefined,
    });

    return {
      venueOrderId: response.ok ? response.orderId : null,
      filledBaseSize: null,
      filledSizeUsd: ticket.sizeUsd,
      averagePrice: null,
      raw: response,
    };
  }
}

export class PolymarketPositionCloseClient implements PositionCloseClient {
  private readonly config: PolymarketExecutionEnv;
  private readonly factory: PolymarketSdkTradingClientFactory;

  constructor(options: PolymarketExecutionClientOptions = {}) {
    this.config = readPolymarketExecutionEnv(undefined, options);
    this.factory = options.factory ?? createPolymarketSdkTradingClient;
  }

  async close(
    position: Position,
    ticket: TradeTicket,
  ): Promise<NonNullable<ExecutionJob["executionResult"]>> {
    const config = assertPolymarketExecutionEnv(this.config);
    const tokenId = ticket.venueData?.outcomeTokenId;
    if (!tokenId || !/^\d+$/.test(tokenId)) {
      throw new Error(
        "Polymarket close requires ticket venueData.outcomeTokenId.",
      );
    }
    const client = await preparePolymarketTradingClient(
      await this.factory(config),
      config,
    );
    const { OrderSide, OrderType } = await import("@polymarket/client");
    const response = await client.placeMarketOrder({
      tokenId,
      amount: position.currentValueUsd,
      side: OrderSide.SELL,
      orderType: OrderType.FAK,
      builderCode: config.builderCode as `0x${string}` | undefined,
    });

    return {
      venueOrderId: response.ok ? response.orderId : null,
      filledBaseSize: position.filledBaseSize,
      filledSizeUsd: position.currentValueUsd,
      averagePrice: position.currentMarkPrice,
      raw: response,
    };
  }
}

async function createPolymarketSdkTradingClient(
  config: RequiredPolymarketExecutionEnv,
): Promise<PolymarketSdkTradingClientLike> {
  const [{ createSecureClient, relayerApiKey }, { privateKey }] =
    await Promise.all([
      import("@polymarket/client"),
      import("@polymarket/client/viem"),
    ]);

  const client = await createSecureClient({
    apiKey:
      config.relayerApiKey && config.relayerApiKeyAddress
        ? relayerApiKey({
            key: config.relayerApiKey,
            address: config.relayerApiKeyAddress,
          })
        : undefined,
    credentials: config.creds,
    signer: privateKey(config.privateKey),
    wallet: config.funderAddress,
  });
  return adaptPolymarketSecureClient(client);
}

function adaptPolymarketSecureClient(
  client: SecureClient,
): PolymarketSdkTradingClientLike {
  return {
    isGaslessReady: () => client.isGaslessReady(),
    setupGaslessWallet: async () =>
      adaptPolymarketSecureClient(await client.setupGaslessWallet()),
    placeMarketOrder: (order) => client.placeMarketOrder(order as never),
  };
}

async function preparePolymarketTradingClient(
  client: PolymarketSdkTradingClientLike,
  config: RequiredPolymarketExecutionEnv,
): Promise<PolymarketSdkTradingClientLike> {
  if (!config.funderAddress) {
    return client;
  }

  if (!config.relayerApiKey || !config.relayerApiKeyAddress) {
    throw new MissingConnectorConfigError(
      "Polymarket gasless trading setup",
      "POLYMARKET_RELAYER_API_KEY, POLYMARKET_RELAYER_API_KEY_ADDRESS",
    );
  }

  return (await client.isGaslessReady())
    ? client
    : await client.setupGaslessWallet();
}
