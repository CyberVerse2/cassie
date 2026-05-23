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
} from "../core/config.ts";
import { Chain, ClobClient, OrderType, Side, type ClobClientOptions, type CreateOrderOptions } from "@polymarket/clob-client-v2";
import { Wallet as EthersWallet } from "ethers";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

export interface PolymarketClobClientLike {
  getTickSize(tokenId: string): Promise<CreateOrderOptions["tickSize"]>;
  getNegRisk(tokenId: string): Promise<boolean>;
  createAndPostMarketOrder(
    order: {
      tokenID: string;
      amount: number;
      side: Side;
      orderType: OrderType.FAK;
    },
    options: Partial<CreateOrderOptions>,
    orderType: OrderType.FAK,
  ): Promise<{ orderID?: string | null; id?: string | null; [key: string]: unknown }>;
}

export type PolymarketClobClientFactory = (options: ClobClientOptions) => PolymarketClobClientLike;

export type PolymarketExecutionClientOptions = PolymarketExecutionEnvOptions & {
  factory?: PolymarketClobClientFactory;
};

export class PolymarketExecutionClient implements ExecutionClient {
  private readonly config: PolymarketExecutionEnv;
  private readonly factory: PolymarketClobClientFactory;

  constructor(options: PolymarketExecutionClientOptions = {}) {
    this.config = readPolymarketExecutionEnv(undefined, options);
    this.factory = options.factory ?? ((clientOptions) => new ClobClient(clientOptions));
  }

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    const config = assertPolymarketExecutionEnv(this.config);
    const tokenId = ticket.venueData?.outcomeTokenId;
    if (!tokenId || !/^\d+$/.test(tokenId)) {
      throw new Error("Polymarket execution requires venueData.outcomeTokenId.");
    }

    const account = privateKeyToAccount(config.privateKey);
    const signer = createWalletClient({ account, transport: http(config.rpcUrl) });
    const client = this.factory({
      host: config.host,
      chain: Chain.POLYGON,
      signer,
      creds: config.creds,
      signatureType: config.signatureType,
      funderAddress: config.funderAddress,
      builderConfig: config.builderCode ? { builderCode: config.builderCode } : undefined,
    });
    const side = ticket.side === "buy_no" || ticket.side === "buy_yes" || ticket.side === "buy"
      ? Side.BUY
      : Side.SELL;
    const tickSize = await client.getTickSize(tokenId);
    const negRisk = await client.getNegRisk(tokenId);
    const response = await client.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        amount: ticket.sizeUsd,
        side,
        orderType: OrderType.FAK,
      },
      { tickSize, negRisk },
      OrderType.FAK,
    );

    return {
      venueOrderId: response?.orderID ?? response?.id ?? null,
      filledSizeUsd: ticket.sizeUsd,
      averagePrice: null,
      raw: response,
    };
  }
}
