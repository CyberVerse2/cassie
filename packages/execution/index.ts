import type { ExecutionJob, TradeTicket } from "../core/schemas/index.ts";
import { MissingConnectorConfigError, readJsonResponse } from "../core/helpers/index.ts";
import {
  assertHyperliquidExecutionEnv,
  assertPolymarketExecutionEnv,
  config,
  readHyperliquidExecutionEnv,
  readPolymarketExecutionEnv,
  type HyperliquidExecutionEnv,
  type HyperliquidExecutionEnvOptions,
  type PolymarketExecutionEnv,
  type PolymarketExecutionEnvOptions,
  type RequiredPolymarketExecutionEnv,
} from "../core/config.ts";
import type { OrderResponse, OrderSide, OrderType, SecureClient } from "@polymarket/client";
import { Wallet as EthersWallet } from "ethers";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatDecimal } from "./helpers/index.ts";

export * from "./helpers/index.ts";

export interface ExecutionClient {
  execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]>;
}

export class WebhookExecutionClient implements ExecutionClient {
  constructor(private readonly endpoint = config.execution.webhookUrl) {}

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    if (!this.endpoint) {
      throw new MissingConnectorConfigError("Execution worker", "EXECUTION_WEBHOOK_URL");
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });

    const payload = await readJsonResponse<{
      venueOrderId?: string | null;
      filledSizeUsd?: number;
      averagePrice?: number | null;
      raw?: unknown;
    }>("Execution worker", response);

    return {
      venueOrderId: payload.venueOrderId ?? null,
      filledSizeUsd: payload.filledSizeUsd ?? 0,
      averagePrice: payload.averagePrice ?? null,
      raw: payload.raw ?? payload,
    };
  }
}

export class VenueExecutionClient implements ExecutionClient {
  constructor(
    private readonly hyperliquid = new HyperliquidExecutionClient(),
    private readonly polymarket = new PolymarketExecutionClient(),
  ) {}

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    if (ticket.venue === "hyperliquid") {
      return this.hyperliquid.execute(ticket);
    }

    if (ticket.venue === "polymarket") {
      return this.polymarket.execute(ticket);
    }

    throw new MissingConnectorConfigError(`Execution venue ${ticket.venue}`, "SUPPORTED_EXECUTION_VENUE");
  }
}

export type HyperliquidExecutionClientOptions = HyperliquidExecutionEnvOptions;

export class HyperliquidExecutionClient implements ExecutionClient {
  private readonly config: HyperliquidExecutionEnv;

  constructor(options: HyperliquidExecutionClientOptions = {}) {
    this.config = readHyperliquidExecutionEnv(undefined, options);
  }

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    const config = assertHyperliquidExecutionEnv(this.config);
    const wallet = new EthersWallet(config.privateKey);
    const transport = new HttpTransport();
    const info = new InfoClient({ transport });
    const exchange = new ExchangeClient({ transport, wallet });
    const asset = await this.resolveAsset(info, ticket);
    const mids = await info.allMids();
    const symbol = ticket.venueData?.symbol ?? ticket.instrument.replace("-PERP", "");
    const mid = Number(mids[symbol]);

    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`No Hyperliquid mid price for ${symbol}.`);
    }

    const isBuy = ticket.side === "long" || ticket.side === "buy";
    const slippage = config.slippageBps / 10_000;
    const price = isBuy ? mid * (1 + slippage) : mid * (1 - slippage);
    const size = ticket.sizeUsd / mid;
    const response = await exchange.order({
      orders: [
        {
          a: asset.id,
          b: isBuy,
          p: formatDecimal(price, config.priceDecimals),
          s: formatDecimal(size, asset.sizeDecimals),
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    });

    return {
      venueOrderId: JSON.stringify(response.response.data.statuses),
      filledSizeUsd: ticket.sizeUsd,
      averagePrice: mid,
      raw: response,
    };
  }

  private async resolveAsset(info: InfoClient, ticket: TradeTicket): Promise<{ id: number; sizeDecimals: number }> {
    const symbol = ticket.venueData?.symbol ?? ticket.instrument.replace("-PERP", "");
    const [meta] = await info.metaAndAssetCtxs();
    const index = meta.universe.findIndex((asset) => asset.name === symbol);

    if (index < 0) {
      throw new Error(`Hyperliquid asset ${symbol} was not found in live exchange metadata.`);
    }

    return {
      id: index,
      sizeDecimals: meta.universe[index]?.szDecimals ?? 6,
    };
  }
}

export interface PolymarketSdkTradingClientLike {
  isGaslessReady(): Promise<boolean>;
  setupGaslessWallet(): Promise<PolymarketSdkTradingClientLike>;
  setupTradingApprovals(): Promise<{ wait(): Promise<unknown> }>;
  placeMarketOrder(order: {
    tokenId: string;
    amount: number;
    side: OrderSide.BUY;
    orderType: OrderType.FAK;
    builderCode?: `0x${string}`;
  }): Promise<OrderResponse>;
}

export type PolymarketSdkTradingClientFactory = (config: RequiredPolymarketExecutionEnv) => Promise<PolymarketSdkTradingClientLike>;

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

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    const config = assertPolymarketExecutionEnv(this.config);
    const tokenId = ticket.venueData?.outcomeTokenId;
    if (!tokenId || !/^\d+$/.test(tokenId)) {
      throw new Error("Polymarket execution requires venueData.outcomeTokenId.");
    }

    if (ticket.side !== "buy_no" && ticket.side !== "buy_yes" && ticket.side !== "buy") {
      throw new Error("Polymarket execution only supports buy-side market orders.");
    }

    const client = await preparePolymarketTradingClient(await this.factory(config), config);
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
      filledSizeUsd: ticket.sizeUsd,
      averagePrice: null,
      raw: response,
    };
  }
}

async function createPolymarketSdkTradingClient(
  config: RequiredPolymarketExecutionEnv,
): Promise<PolymarketSdkTradingClientLike> {
  const [{ createSecureClient, relayerApiKey }, { privateKey }] = await Promise.all([
    import("@polymarket/client"),
    import("@polymarket/client/viem"),
  ]);

  const client = await createSecureClient({
    apiKey: config.relayerApiKey && config.relayerApiKeyAddress
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

function adaptPolymarketSecureClient(client: SecureClient): PolymarketSdkTradingClientLike {
  return {
    isGaslessReady: () => client.isGaslessReady(),
    setupGaslessWallet: async () => adaptPolymarketSecureClient(await client.setupGaslessWallet()),
    setupTradingApprovals: () => client.setupTradingApprovals(),
    placeMarketOrder: (order) => client.placeMarketOrder(order),
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

  const gaslessClient = await client.isGaslessReady()
    ? client
    : await client.setupGaslessWallet();
  const approvals = await gaslessClient.setupTradingApprovals();
  await approvals.wait();
  return gaslessClient;
}
