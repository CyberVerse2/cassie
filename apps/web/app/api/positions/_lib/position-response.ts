import type { Position, TradeTicket } from "../../../../../../packages/core/schemas/index.ts";

export type UserFacingPosition = Position & {
  symbol: string | null;
  marginUsd: number;
  leverage: number | null;
  notionalValueUsd: number | null;
  positionEquityUsd: number;
};

export function decoratePosition(position: Position, ticket?: TradeTicket): UserFacingPosition {
  const leverage = positionLeverage(position, ticket);
  const isLeveraged = leverage != null && leverage > 1;
  return {
    ...position,
    symbol: ticket?.venueData?.symbol?.trim() || null,
    marginUsd: position.entrySizeUsd,
    leverage,
    notionalValueUsd: isLeveraged ? position.currentValueUsd : null,
    positionEquityUsd: isLeveraged
      ? roundUsd(position.entrySizeUsd + position.unrealizedPnlUsd)
      : position.currentValueUsd,
  };
}

function positionLeverage(position: Position, ticket?: TradeTicket) {
  const ticketLeverage = ticket?.venueData?.leverage;
  if (ticketLeverage && ticketLeverage > 1) return ticketLeverage;
  if (position.venue !== "hyperliquid" || position.entrySizeUsd <= 0) return null;
  const inferred = position.filledSizeUsd / position.entrySizeUsd;
  return inferred > 1.01 ? Math.round(inferred * 100) / 100 : null;
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}
