import { randomUUID } from "node:crypto";
import { PolymarketMarketDataProvider } from "../adapters/index.ts";
import type { PolymarketMarketFinder } from "../adapters/selection.ts";
import { readJsonResponse } from "../core/helpers/connector-errors.ts";
import type {
  ExecutionJob,
  Position,
  TradeTicket,
} from "../core/schemas/index.ts";
import {
  CompositePositionMarkProvider,
  type PositionMarkProvider,
} from "../positions/marks.ts";
import {
  fetchHyperliquidSpotMid,
  isHyperliquidSpotSymbol,
} from "./hyperliquid-spot.ts";
import type {
  ExecutionClient,
  ExecutionContext,
  PositionCloseClient,
} from "./index.ts";

type ExecutionResult = NonNullable<ExecutionJob["executionResult"]>;

export type HyperliquidMidSource = (symbol: string) => Promise<number>;

// Paper-trading execution: fills tickets at the live market price without
// sending any order to the venue. The ledger, positions, PnL, and reviews all
// behave exactly as they do for real fills; only the venue order is skipped.
export class SimulatedExecutionClient implements ExecutionClient {
  private readonly hyperliquidMid: HyperliquidMidSource;
  private readonly hyperliquidSpotMid: HyperliquidMidSource;
  private readonly polymarket: PolymarketMarketFinder;

  constructor(input: {
    hyperliquidMid?: HyperliquidMidSource;
    hyperliquidSpotMid?: HyperliquidMidSource;
    polymarket?: PolymarketMarketFinder;
  } = {}) {
    this.hyperliquidMid = input.hyperliquidMid ?? fetchHyperliquidMid;
    this.hyperliquidSpotMid = input.hyperliquidSpotMid ?? fetchHyperliquidSpotMid;
    this.polymarket = input.polymarket ?? new PolymarketMarketDataProvider();
  }

  async execute(ticket: TradeTicket, context: ExecutionContext = {}): Promise<ExecutionResult> {
    void context;
    if (ticket.venue === "hyperliquid") {
      return this.executeHyperliquid(ticket);
    }
    if (ticket.venue === "polymarket") {
      return this.executePolymarket(ticket);
    }
    throw new Error(`No simulated execution configured for venue ${ticket.venue}.`);
  }

  private async executeHyperliquid(ticket: TradeTicket): Promise<ExecutionResult> {
    const symbol = hyperliquidTicketSymbol(ticket);
    // allMids keys spot pairs as "@{index}", not "BASE/QUOTE" — spot symbols
    // go through metadata resolution instead.
    const price = isHyperliquidSpotSymbol(symbol)
      ? await this.hyperliquidSpotMid(symbol)
      : await this.hyperliquidMid(symbol);
    assertPositivePrice(price, `Hyperliquid mid for ${symbol}`);
    const leverage = ticket.venueData?.leverage ?? 1;
    const notionalUsd = roundUsd(ticket.sizeUsd * leverage);
    return {
      venueOrderId: simulatedOrderId(),
      filledBaseSize: notionalUsd / price,
      filledSizeUsd: notionalUsd,
      collateralUsedUsd: ticket.sizeUsd,
      averagePrice: price,
    };
  }

  private async executePolymarket(ticket: TradeTicket): Promise<ExecutionResult> {
    const outcomeTokenId = ticket.venueData?.outcomeTokenId;
    if (!outcomeTokenId) {
      throw new Error("Simulated Polymarket execution requires ticket venueData.outcomeTokenId.");
    }
    const quote = await this.polymarket.quotePolymarketMarket({
      conditionId: ticket.venueData?.conditionId,
      outcomeTokenId,
      side: ticket.side === "buy_no" ? "no" : "yes",
    });
    const price = quote.heldSidePrice;
    assertPositivePrice(price, `Polymarket quote for ${outcomeTokenId}`);
    return {
      venueOrderId: simulatedOrderId(),
      filledBaseSize: ticket.sizeUsd / price,
      filledSizeUsd: ticket.sizeUsd,
      averagePrice: price,
    };
  }
}

// Paper-trading close: settles the position at the live mark price using the
// same mark providers the position-review job uses.
export class SimulatedPositionCloseClient implements PositionCloseClient {
  constructor(
    private readonly markProvider: PositionMarkProvider = new CompositePositionMarkProvider(),
  ) {}

  async close(position: Position, ticket: TradeTicket): Promise<ExecutionResult> {
    const mark = await this.markProvider.markPosition({ position, ticket });
    return {
      venueOrderId: simulatedOrderId(),
      filledBaseSize: position.filledBaseSize,
      filledSizeUsd: mark.currentValueUsd,
      averagePrice: mark.markPrice,
    };
  }
}

export function simulatedOrderId(): string {
  return `sim:${randomUUID()}`;
}

async function fetchHyperliquidMid(
  symbol: string,
  endpoint = "https://api.hyperliquid.xyz/info",
): Promise<number> {
  const separatorIndex = symbol.indexOf(":");
  const dex = separatorIndex > 0 ? symbol.slice(0, separatorIndex) : null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dex ? { type: "allMids", dex } : { type: "allMids" }),
  });
  const mids = await readJsonResponse<Record<string, string>>(
    "Hyperliquid simulated execution mid",
    response,
  );
  return Number(mids[symbol]);
}

function hyperliquidTicketSymbol(ticket: TradeTicket): string {
  const raw = ticket.venueData?.symbol ?? ticket.instrument;
  return raw.replace(/-PERP$/u, "");
}

function assertPositivePrice(price: number, label: string): void {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`${label} returned no usable price.`);
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
