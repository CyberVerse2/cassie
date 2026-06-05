import type { Position, TradeTicket } from "../../../../../../packages/core/schemas/index.ts";

export type UserFacingPosition = Position & {
  symbol: string | null;
};

export function decoratePosition(position: Position, ticket?: TradeTicket): UserFacingPosition {
  return {
    ...position,
    symbol: ticket?.venueData?.symbol?.trim() || null,
  };
}
