import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import { type ExecutionJob, type Position, type TradeTicket } from "../core/schemas/index.ts";
import { HyperliquidPositionCloseClient, PolymarketPositionCloseClient, type PositionCloseClient } from "../execution/index.ts";
import { GraphileExecutionJobQueue, type CassieJobQueue } from "../jobs/queue.ts";

export type PositionCloseResult = NonNullable<ExecutionJob["executionResult"]>;

export class VenuePositionCloseClient implements PositionCloseClient {
  constructor(
    private readonly hyperliquid = new HyperliquidPositionCloseClient(),
    private readonly polymarket = new PolymarketPositionCloseClient(),
  ) {}

  async close(position: Position, ticket: TradeTicket): Promise<PositionCloseResult> {
    if (position.venue === "hyperliquid") return this.hyperliquid.close(position, ticket);
    if (position.venue === "polymarket") return this.polymarket.close(position, ticket);
    throw new Error(`No close client configured for venue ${position.venue}.`);
  }
}

export async function queueClosePosition(input: {
  positionId: string;
  store?: CassieStore;
  jobQueue?: CassieJobQueue;
}): Promise<Position> {
  const store = input.store ?? new DrizzleCassieStore();
  const jobQueue = input.jobQueue ?? new GraphileExecutionJobQueue();
  const position = await store.getPosition(input.positionId);
  if (!position) throw new Error(`Position ${input.positionId} was not found.`);
  if (position.status !== "open" && position.status !== "close_failed") {
    throw new Error(`Position ${input.positionId} cannot be closed from status ${position.status}.`);
  }
  const now = new Date().toISOString();
  const updated = await store.updatePosition({
    ...position,
    status: "closing",
    updatedAt: now,
    failureReason: null,
  });
  const queued = await jobQueue.enqueueClosePosition({ positionId: input.positionId });
  await store.audit({
    entityId: input.positionId,
    entityType: "position",
    eventType: "position.close_queued",
    message: "Position close queued.",
    data: { graphileJobId: queued.graphileJobId },
  });
  return updated;
}

export async function executeClosePosition(input: {
  positionId: string;
  store?: CassieStore;
  closeClient?: PositionCloseClient;
}): Promise<Position> {
  const store = input.store ?? new DrizzleCassieStore();
  const position = await store.getPosition(input.positionId);
  if (!position) throw new Error(`Position ${input.positionId} was not found.`);
  if (position.status === "closed") return position;
  if (position.status !== "closing") {
    throw new Error(`Position ${input.positionId} must be closing before close execution.`);
  }
  const ticket = await store.getTradeTicket(position.ticketId);
  if (!ticket) throw new Error(`Trade ticket ${position.ticketId} was not found.`);
  const closeClient = input.closeClient ?? new VenuePositionCloseClient();

  try {
    const result = await closeClient.close(position, ticket);
    const now = new Date().toISOString();
    const closed = await store.updatePosition({
      ...position,
      status: "closed",
      currentValueUsd: 0,
      updatedAt: now,
      closedAt: now,
      closeExecutionJobId: result.venueOrderId,
      failureReason: null,
    });
    await store.audit({
      entityId: position.positionId,
      entityType: "position",
      eventType: "position.closed",
      message: "Position closed.",
      data: result,
    });
    return closed;
  } catch (error) {
    const now = new Date().toISOString();
    const failed = await store.updatePosition({
      ...position,
      status: "close_failed",
      updatedAt: now,
      failureReason: error instanceof Error ? error.message : String(error),
    });
    await store.audit({
      entityId: position.positionId,
      entityType: "position",
      eventType: "position.close_failed",
      message: "Position close failed.",
      data: { failureReason: failed.failureReason },
    });
    return failed;
  }
}
