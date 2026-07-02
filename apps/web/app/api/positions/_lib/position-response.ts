import type { Position, TradeTicket } from "../../../../../../packages/core/schemas/index.ts";
import {
  positionEquityUsd,
  positionLeverage,
} from "../../../../../../packages/positions/portfolio.ts";

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
    positionEquityUsd: positionEquityUsd(position, ticket),
  };
}
