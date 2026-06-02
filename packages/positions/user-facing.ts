import type { Position, TradeTicket } from "../core/schemas/index.ts";
import { HyperliquidPositionMarkProvider, type PositionMarkProvider } from "./marks.ts";
import { applyPositionMark } from "./review.ts";

export async function markUserFacingHyperliquidPositions(
  positions: Position[],
  tickets: Map<string, TradeTicket>,
  hyperliquidMarkProvider: PositionMarkProvider = new HyperliquidPositionMarkProvider(),
): Promise<Position[]> {
  return Promise.all(positions.map(async (position) => {
    if (position.venue !== "hyperliquid" || position.status !== "open") {
      return position;
    }
    const ticket = tickets.get(position.ticketId);
    if (!ticket) {
      throw new Error(`Trade ticket ${position.ticketId} was not found.`);
    }
    const mark = await hyperliquidMarkProvider.markPosition({ position, ticket });
    return applyPositionMark(position, mark.markPrice, mark.currentValueUsd, mark.markedAt);
  }));
}
