import { randomUUID } from "node:crypto";
import type { ExecutionJob, TradeTicket } from "./schemas.js";
import { MissingConnectorConfigError, readJsonResponse } from "./connectors/errors.js";
import { ClobClient, Chain, OrderType, Side, type ClobSigner } from "@polymarket/clob-client";
import { Wallet as EthersWallet } from "ethers";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";

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
    private readonly assetIdMap = process.env.HYPERLIQUID_ASSET_IDS ?? "",
  ) {}

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    if (!this.privateKey) {
      throw new MissingConnectorConfigError("Hyperliquid execution", "HYPERLIQUID_PRIVATE_KEY");
    }

    const assetId = this.resolveAssetId(ticket);
    const wallet = new EthersWallet(this.privateKey);
    const transport = new HttpTransport();
    const info = new InfoClient({ transport });
    const exchange = new ExchangeClient({ transport, wallet });
    const mids = await info.allMids();
    const mid = Number(mids[ticket.instrument] ?? mids[ticket.instrument.replace("-PERP", "")]);

    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`No Hyperliquid mid price for ${ticket.instrument}.`);
    }

    const isBuy = ticket.side === "long" || ticket.side === "buy";
    const slippage = 0.01;
    const price = isBuy ? mid * (1 + slippage) : mid * (1 - slippage);
    const size = ticket.sizeUsd / mid;
    const response = await exchange.order({
      orders: [
        {
          a: assetId,
          b: isBuy,
          p: price.toFixed(6),
          s: size.toFixed(6),
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

  private resolveAssetId(ticket: TradeTicket): number {
    const symbol = ticket.instrument.replace("-PERP", "");
    for (const pair of this.assetIdMap.split(",")) {
      const [key, value] = pair.split(":").map((part) => part?.trim());
      if (key === symbol && value && Number.isInteger(Number(value))) {
        return Number(value);
      }
    }

    throw new MissingConnectorConfigError(
      `Hyperliquid asset id for ${symbol}`,
      "HYPERLIQUID_ASSET_IDS",
    );
  }
}

export class PolymarketExecutionClient implements ExecutionClient {
  constructor(
    private readonly privateKey = process.env.POLYMARKET_PRIVATE_KEY,
    private readonly host = process.env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com",
  ) {}

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    if (!this.privateKey) {
      throw new MissingConnectorConfigError("Polymarket execution", "POLYMARKET_PRIVATE_KEY");
    }

    const tokenId = ticket.instrument;
    if (!/^\d+$/.test(tokenId)) {
      throw new Error("Polymarket execution requires instrument to be the outcome token ID.");
    }

    const wallet = new EthersWallet(this.privateKey);
    const signer: ClobSigner = {
      getAddress: () => wallet.getAddress(),
      _signTypedData: (domain, types, value) => wallet.signTypedData(domain, types, value),
    };
    const client = new ClobClient(this.host, Chain.POLYGON, signer);
    const side = ticket.side === "buy_no" || ticket.side === "buy_yes" || ticket.side === "buy"
      ? Side.BUY
      : Side.SELL;
    const response = await client.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        amount: ticket.sizeUsd,
        side,
      },
      {},
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
