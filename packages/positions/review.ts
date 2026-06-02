import { randomUUID } from "node:crypto";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { ExitSignal, Position, PositionReview } from "../core/schemas/index.ts";
import { sendDailyPositionSummaries } from "../notifications/positions.ts";
import { CompositePositionMarkProvider, type PositionMarkProvider } from "./marks.ts";

export type PositionReviewResult = {
  reviewed: number;
  succeeded: number;
  failed: number;
  reviews: PositionReview[];
};

export async function reviewAllOpenPositions(input: {
  store?: CassieStore;
  markProvider?: PositionMarkProvider;
  notify?: boolean;
} = {}): Promise<PositionReviewResult> {
  return reviewOpenPositions({
    store: input.store,
    markProvider: input.markProvider,
    notify: input.notify,
  });
}

export async function reviewOpenPositionsForUser(input: {
  userId: string;
  store?: CassieStore;
  markProvider?: PositionMarkProvider;
  notify?: boolean;
}): Promise<PositionReviewResult> {
  return reviewOpenPositions(input);
}

async function reviewOpenPositions(input: {
  userId?: string;
  store?: CassieStore;
  markProvider?: PositionMarkProvider;
  notify?: boolean;
}): Promise<PositionReviewResult> {
  const store = input.store ?? new DrizzleCassieStore();
  const markProvider = input.markProvider ?? new CompositePositionMarkProvider();
  const positions = await store.listOpenPositions(input.userId);
  const reviews: PositionReview[] = [];

  for (const position of positions) {
    reviews.push(await reviewPosition({ store, markProvider, position }));
  }

  if (input.notify ?? true) {
    await sendDailyPositionSummaries({ store, userId: input.userId }).catch(async (error) => {
      await store.audit({
        entityId: input.userId ?? "all",
        entityType: "position",
        eventType: "position_review.notification_failed",
        message: "Daily position summary notification failed.",
        data: { error: error instanceof Error ? error.message : String(error) },
      });
    });
  }

  return {
    reviewed: reviews.length,
    succeeded: reviews.filter((review) => review.status === "succeeded").length,
    failed: reviews.filter((review) => review.status === "failed").length,
    reviews,
  };
}

async function reviewPosition(input: {
  store: CassieStore;
  markProvider: PositionMarkProvider;
  position: Position;
}): Promise<PositionReview> {
  const ticket = await input.store.getTradeTicket(input.position.ticketId);
  if (!ticket) {
    return recordFailedReview(input.store, input.position, `Trade ticket ${input.position.ticketId} was not found.`);
  }

  try {
    const mark = await input.markProvider.markPosition({ position: input.position, ticket });
    const updated = applyPositionMark(input.position, mark.markPrice, mark.currentValueUsd, mark.markedAt);
    await input.store.updatePosition(updated);
    const exitSignal = exitSignalForPosition(updated);
    const review: PositionReview = {
      reviewId: randomUUID(),
      positionId: updated.positionId,
      userId: updated.userId,
      reviewedAt: mark.markedAt,
      status: "succeeded",
      markPrice: updated.currentMarkPrice,
      currentValueUsd: updated.currentValueUsd,
      unrealizedPnlUsd: updated.unrealizedPnlUsd,
      unrealizedPnlPct: updated.unrealizedPnlPct,
      exitSignal,
      summary: reviewSummary(updated, exitSignal),
      failureReason: null,
    };
    return input.store.addPositionReview(review);
  } catch (error) {
    return recordFailedReview(input.store, input.position, error instanceof Error ? error.message : String(error));
  }
}

export function applyPositionMark(position: Position, markPrice: number, currentValueUsd: number, markedAt: string): Position {
  const unrealizedPnlUsd = roundUsd(currentValueUsd - position.filledSizeUsd);
  const pnlBasisUsd = position.entrySizeUsd > 0 ? position.entrySizeUsd : position.filledSizeUsd;
  const unrealizedPnlPct = pnlBasisUsd > 0
    ? roundPct((unrealizedPnlUsd / pnlBasisUsd) * 100)
    : 0;
  return {
    ...position,
    currentMarkPrice: markPrice,
    currentValueUsd,
    unrealizedPnlUsd,
    unrealizedPnlPct,
    updatedAt: markedAt,
    lastMarkedAt: markedAt,
    failureReason: null,
  };
}

function exitSignalForPosition(position: Position): ExitSignal {
  if (position.unrealizedPnlPct >= position.exitPlan.takeProfitPct) return "take_profit";
  if (position.unrealizedPnlPct <= -position.exitPlan.stopLossPct) return "stop_loss";
  const maxHoldMs = position.exitPlan.maxHoldDays * 24 * 60 * 60 * 1000;
  if (Date.now() - Date.parse(position.openedAt) >= maxHoldMs) return "max_hold";
  return "none";
}

function reviewSummary(position: Position, exitSignal: ExitSignal): string {
  if (exitSignal === "none") {
    return `${position.instrument} ${position.side} is marked at ${formatNullable(position.currentMarkPrice)} with ${formatPct(position.unrealizedPnlPct)} unrealized P/L. Hold.`;
  }
  return `${position.instrument} ${position.side} triggered ${exitSignal.replace(/_/gu, " ")} at ${formatPct(position.unrealizedPnlPct)} unrealized P/L. Review close action in dashboard.`;
}

function recordFailedReview(store: CassieStore, position: Position, failureReason: string): Promise<PositionReview> {
  const now = new Date().toISOString();
  return store.addPositionReview({
    reviewId: randomUUID(),
    positionId: position.positionId,
    userId: position.userId,
    reviewedAt: now,
    status: "failed",
    markPrice: null,
    currentValueUsd: null,
    unrealizedPnlUsd: null,
    unrealizedPnlPct: null,
    exitSignal: "none",
    summary: "Position review failed.",
    failureReason,
  });
}

function formatNullable(value: number | null): string {
  return value == null ? "unavailable" : String(value);
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}
