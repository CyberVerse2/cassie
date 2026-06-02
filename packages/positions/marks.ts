import { PolymarketMarketDataProvider } from "../adapters/index.ts";
import type { PolymarketMarketFinder } from "../adapters/selection.ts";
import { readJsonResponse } from "../core/helpers/connector-errors.ts";
import type { Position, TradeTicket } from "../core/schemas/index.ts";

type HyperliquidAllMids = Record<string, string>;

export type PositionMark = {
  markPrice: number;
  currentValueUsd: number;
  markedAt: string;
};

export interface PositionMarkProvider {
  markPosition(input: {
    position: Position;
    ticket: TradeTicket;
  }): Promise<PositionMark>;
}

export class CompositePositionMarkProvider implements PositionMarkProvider {
  constructor(
    private readonly hyperliquid = new HyperliquidPositionMarkProvider(),
    private readonly polymarket: PositionMarkProvider = new PolymarketPositionMarkProvider(),
  ) {}

  async markPosition(input: { position: Position; ticket: TradeTicket }): Promise<PositionMark> {
    if (input.position.venue === "hyperliquid") {
      return this.hyperliquid.markPosition(input);
    }
    if (input.position.venue === "polymarket") {
      return this.polymarket.markPosition(input);
    }
    throw new Error(`No mark provider configured for venue ${input.position.venue}.`);
  }
}

export class HyperliquidPositionMarkProvider implements PositionMarkProvider {
  private allMidsPromise: Promise<HyperliquidAllMids> | null = null;

  constructor(private readonly endpoint = "https://api.hyperliquid.xyz/info") {}

  async markPosition(input: { position: Position; ticket: TradeTicket }): Promise<PositionMark> {
    const symbol = hyperliquidSymbol(input.ticket, input.position);
    const mids = await this.allMids();
    const markPrice = Number(mids[symbol]);
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      throw new Error(`No Hyperliquid mark price for ${symbol}.`);
    }
    return markFromPrice(input.position, markPrice);
  }

  private allMids(): Promise<HyperliquidAllMids> {
    this.allMidsPromise ??= this.fetchAllMids();
    return this.allMidsPromise;
  }

  private async fetchAllMids(): Promise<HyperliquidAllMids> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    return readJsonResponse<HyperliquidAllMids>("Hyperliquid position mark", response);
  }
}

export class PolymarketPositionMarkProvider implements PositionMarkProvider {
  constructor(private readonly polymarket: PolymarketMarketFinder = new PolymarketMarketDataProvider()) {}

  async markPosition(input: { position: Position; ticket: TradeTicket }): Promise<PositionMark> {
    const outcomeTokenId = input.ticket.venueData?.outcomeTokenId;
    if (!outcomeTokenId) {
      throw new Error("Polymarket position mark requires ticket venueData.outcomeTokenId.");
    }
    const side = input.ticket.side === "buy_no" ? "no" : "yes";
    const quote = await this.polymarket.quotePolymarketMarket({
      conditionId: input.ticket.venueData?.conditionId,
      outcomeTokenId,
      side,
    });
    return markFromPrice(input.position, quote.heldSidePrice);
  }
}

export function markFromPrice(position: Position, markPrice: number, markedAt = new Date().toISOString()): PositionMark {
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error("Position mark price must be positive.");
  }
  if (!position.entryPrice || position.entryPrice <= 0) {
    return {
      markPrice,
      currentValueUsd: position.filledSizeUsd,
      markedAt,
    };
  }
  const direction = position.side === "short" || position.side === "sell" ? -1 : 1;
  const pnlPct = ((markPrice - position.entryPrice) / position.entryPrice) * 100 * direction;
  return {
    markPrice,
    currentValueUsd: roundUsd(position.filledSizeUsd * (1 + pnlPct / 100)),
    markedAt,
  };
}

function hyperliquidSymbol(ticket: TradeTicket, position: Position): string {
  const raw = ticket.venueData?.symbol ?? ticket.instrument ?? position.instrument;
  return raw.replace(/-PERP$/u, "");
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
