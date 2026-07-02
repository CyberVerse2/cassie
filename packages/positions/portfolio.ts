import type { CassieStore } from "../core/db/store.ts";
import type { Position, TradeTicket } from "../core/schemas/index.ts";

export function positionLeverage(
  position: Position,
  ticket?: TradeTicket,
): number | null {
  const ticketLeverage = ticket?.venueData?.leverage;
  if (ticketLeverage && ticketLeverage > 1) return ticketLeverage;
  if (position.venue !== "hyperliquid" || position.entrySizeUsd <= 0) return null;
  const inferred = position.filledSizeUsd / position.entrySizeUsd;
  return inferred > 1.01 ? Math.round(inferred * 100) / 100 : null;
}

// Equity the user actually holds in a position: for leveraged perps it's
// collateral + PnL; for spot/prediction it's the current value.
export function positionEquityUsd(
  position: Position,
  ticket?: TradeTicket,
): number {
  const leverage = positionLeverage(position, ticket);
  const isLeveraged = leverage != null && leverage > 1;
  return isLeveraged
    ? roundUsd(position.entrySizeUsd + position.unrealizedPnlUsd)
    : position.currentValueUsd;
}

function isOpenPositionStatus(status: Position["status"]): boolean {
  return status === "open" || status === "closing" || status === "close_failed";
}

// Computes and records one portfolio-balance snapshot for a user from their
// current open positions plus a supplied wallet (USDC) balance. Used by the
// review cron so history is captured on a fixed cadence rather than as a
// side effect of a dashboard GET.
export async function recordPortfolioSnapshotForUser(input: {
  store: CassieStore;
  userId: string;
  walletBalanceUsd: number;
  at?: string;
}): Promise<void> {
  const positions = (await input.store.listUserPositions(input.userId)).filter(
    (position) => isOpenPositionStatus(position.status),
  );
  const tickets = new Map(
    (await input.store.getTradeTickets(positions.map((p) => p.ticketId))).map(
      (ticket) => [ticket.ticketId, ticket],
    ),
  );

  const openEquityUsd = roundUsd(
    positions.reduce(
      (total, position) =>
        total + positionEquityUsd(position, tickets.get(position.ticketId)),
      0,
    ),
  );
  const unrealizedPnlUsd = roundUsd(
    positions.reduce((total, position) => total + position.unrealizedPnlUsd, 0),
  );

  await input.store.recordPortfolioBalanceSnapshot({
    userId: input.userId,
    at: input.at,
    valueUsd: roundUsd(input.walletBalanceUsd + openEquityUsd),
    walletBalanceUsd: roundUsd(input.walletBalanceUsd),
    unrealizedPnlUsd,
  });
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
