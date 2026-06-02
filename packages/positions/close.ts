import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import { type ExecutionJob, type Position, type TradeTicket } from "../core/schemas/index.ts";
import { PrivyAdapter, type PrivyWalletGateway, type WalletUsdcTransfer } from "../adapters/privy/index.ts";
import { HyperliquidPositionCloseClient, PolymarketPositionCloseClient, type PositionCloseClient } from "../execution/index.ts";
import { GraphileExecutionJobQueue, type CassieJobQueue } from "../jobs/queue.ts";

export type PositionCloseResult = NonNullable<ExecutionJob["executionResult"]>;
type PositionRefundGateway = Pick<PrivyWalletGateway, "refundUserUsdcFromTreasury">;

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
  walletGateway?: PositionRefundGateway;
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
    const settings = await store.getUserSettings(position.userId);
    if (!settings?.walletAddress) {
      throw new Error("Position close refund requires a user wallet address.");
    }
    const result = await closeClient.close(position, ticket);
    assertFullCloseFill(position, result);
    const walletGateway = input.walletGateway ?? new PrivyAdapter();
    const refundTransfer = await refundClosedPosition({
      walletGateway,
      userWalletAddress: settings.walletAddress,
      position,
      result,
    });
    const now = new Date().toISOString();
    const realizedPnlUsd = roundUsd(result.filledSizeUsd - position.filledSizeUsd);
    const pnlBasisUsd = position.entrySizeUsd > 0 ? position.entrySizeUsd : position.filledSizeUsd;
    const realizedPnlPct = pnlBasisUsd > 0 ? roundPct((realizedPnlUsd / pnlBasisUsd) * 100) : 0;
    const closed = await store.updatePosition({
      ...position,
      status: "closed",
      currentMarkPrice: result.averagePrice ?? position.currentMarkPrice,
      currentValueUsd: 0,
      unrealizedPnlUsd: realizedPnlUsd,
      unrealizedPnlPct: realizedPnlPct,
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
      data: { result, refundTransfer },
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

function assertFullCloseFill(position: Position, result: PositionCloseResult): void {
  if (position.filledBaseSize == null || position.filledBaseSize <= 0) {
    throw new Error(`Position ${position.positionId} is missing filledBaseSize.`);
  }
  if (result.filledBaseSize == null || result.filledBaseSize <= 0) {
    throw new Error(`Position close returned no filled base size for ${position.positionId}.`);
  }
  const tolerance = Math.max(0.00000001, position.filledBaseSize * 0.000001);
  if (result.filledBaseSize + tolerance < position.filledBaseSize) {
    throw new Error(`Position close filled ${result.filledBaseSize} base units, expected ${position.filledBaseSize}.`);
  }
}

async function refundClosedPosition(input: {
  walletGateway: PositionRefundGateway;
  userWalletAddress: string;
  position: Position;
  result: PositionCloseResult;
}): Promise<WalletUsdcTransfer | null> {
  const amountUsd = roundUsd(input.result.filledSizeUsd);
  if (amountUsd <= 0) return null;
  return input.walletGateway.refundUserUsdcFromTreasury({
    userWalletAddress: input.userWalletAddress,
    amountUsd,
    referenceId: `position_close:${input.position.positionId}`,
  });
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}
