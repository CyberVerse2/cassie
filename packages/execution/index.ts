import { randomUUID } from "node:crypto";
import type { ExecutionJob, TradeTicket } from "../core/schemas/index.ts";
import { MissingConnectorConfigError, readJsonResponse } from "../core/connector-errors.ts";
import { Chain, ClobClient, OrderType, Side, SignatureTypeV2, type ApiKeyCreds, type ClobClientOptions, type CreateOrderOptions } from "@polymarket/clob-client-v2";
import { Wallet as EthersWallet } from "ethers";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface ExecutionClient {
  execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]>;
}

export class WebhookExecutionClient implements ExecutionClient {
  constructor(private readonly endpoint = process.env.EXECUTION_WEBHOOK_URL) {}

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

export class HyperliquidExecutionClient implements ExecutionClient {
  constructor(
    private readonly privateKey = process.env.HYPERLIQUID_PRIVATE_KEY,
    private readonly slippageBps = Number(process.env.HYPERLIQUID_EXECUTION_SLIPPAGE_BPS ?? 100),
  ) {}

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    if (!this.privateKey) {
      throw new MissingConnectorConfigError("Hyperliquid execution", "HYPERLIQUID_PRIVATE_KEY");
    }

    const wallet = new EthersWallet(this.privateKey);
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
    const slippage = this.slippageBps / 10_000;
    const price = isBuy ? mid * (1 + slippage) : mid * (1 - slippage);
    const size = ticket.sizeUsd / mid;
    const response = await exchange.order({
      orders: [
        {
          a: asset.id,
          b: isBuy,
          p: formatDecimal(price, Number(process.env.HYPERLIQUID_PRICE_DECIMALS ?? 5)),
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

export type PolymarketExecutionClientOptions = {
  privateKey?: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  host?: string;
  rpcUrl?: string;
  signatureType?: SignatureTypeV2;
  funderAddress?: string;
  factory?: PolymarketClobClientFactory;
};

export class PolymarketExecutionClient implements ExecutionClient {
  private readonly privateKey?: string;
  private readonly creds?: ApiKeyCreds;
  private readonly host: string;
  private readonly rpcUrl: string;
  private readonly signatureType?: SignatureTypeV2;
  private readonly funderAddress?: string;
  private readonly factory: PolymarketClobClientFactory;

  constructor(options: PolymarketExecutionClientOptions = {}) {
    this.privateKey = options.privateKey ?? process.env.POLYMARKET_PRIVATE_KEY;
    this.host = options.host ?? process.env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com";
    this.rpcUrl = options.rpcUrl ?? process.env.POLYMARKET_RPC_URL ?? "https://polygon-rpc.com";
    this.signatureType = options.signatureType ?? parsePolymarketSignatureType(process.env.POLYMARKET_SIGNATURE_TYPE);
    this.funderAddress = options.funderAddress ?? process.env.POLYMARKET_FUNDER_ADDRESS;
    this.factory = options.factory ?? ((clientOptions) => new ClobClient(clientOptions));

    const key = options.apiKey ?? process.env.POLYMARKET_CLOB_API_KEY;
    const secret = options.apiSecret ?? process.env.POLYMARKET_CLOB_SECRET;
    const passphrase = options.apiPassphrase ?? process.env.POLYMARKET_CLOB_PASS_PHRASE;
    this.creds = key && secret && passphrase
      ? { key, secret, passphrase }
      : undefined;
  }

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    if (!this.privateKey) {
      throw new MissingConnectorConfigError("Polymarket execution", "POLYMARKET_PRIVATE_KEY");
    }
    if (!this.creds) {
      throw new MissingConnectorConfigError("Polymarket execution", "POLYMARKET_CLOB_API_KEY, POLYMARKET_CLOB_SECRET, POLYMARKET_CLOB_PASS_PHRASE");
    }

    const tokenId = ticket.venueData?.outcomeTokenId;
    if (!tokenId || !/^\d+$/.test(tokenId)) {
      throw new Error("Polymarket execution requires venueData.outcomeTokenId.");
    }

    const account = privateKeyToAccount(normalizePrivateKey(this.privateKey));
    const signer = createWalletClient({ account, transport: http(this.rpcUrl) });
    const client = this.factory({
      host: this.host,
      chain: Chain.POLYGON,
      signer,
      creds: this.creds,
      signatureType: this.signatureType,
      funderAddress: this.funderAddress,
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

function normalizePrivateKey(privateKey: string): `0x${string}` {
  return privateKey.startsWith("0x") ? privateKey as `0x${string}` : `0x${privateKey}` as `0x${string}`;
}

function parsePolymarketSignatureType(value: string | undefined): SignatureTypeV2 | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (
    parsed === SignatureTypeV2.EOA ||
    parsed === SignatureTypeV2.POLY_PROXY ||
    parsed === SignatureTypeV2.POLY_GNOSIS_SAFE ||
    parsed === SignatureTypeV2.POLY_1271
  ) {
    return parsed;
  }
  throw new Error("POLYMARKET_SIGNATURE_TYPE must be 0, 1, 2, or 3.");
}

function formatDecimal(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const truncated = Math.floor(value * factor) / factor;
  return truncated.toFixed(decimals).replace(/\.?0+$/, "");
}

export function createQueuedExecutionJob(ticketId: string): ExecutionJob {
  const now = new Date().toISOString();

  return {
    jobId: randomUUID(),
    ticketId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    failureReason: null,
    executionResult: null,
  };
}

export function markExecutionRunning(job: ExecutionJob): ExecutionJob {
  return {
    ...job,
    status: "running",
    updatedAt: new Date().toISOString(),
  };
}

export function markExecutionSucceeded(
  job: ExecutionJob,
  executionResult: ExecutionJob["executionResult"],
): ExecutionJob {
  return {
    ...job,
    status: "succeeded",
    updatedAt: new Date().toISOString(),
    executionResult,
  };
}

export function markExecutionFailed(job: ExecutionJob, failureReason: string): ExecutionJob {
  return {
    ...job,
    status: "failed",
    updatedAt: new Date().toISOString(),
    failureReason,
  };
}
