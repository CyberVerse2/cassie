import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { Position, TradeExitPlan, TradeTicket, UserSettings } from "../packages/core/schemas/index.ts";
import type { PositionCloseClient } from "../packages/execution/index.ts";
import { executeClosePosition, queueClosePosition } from "../packages/positions/close.ts";
import type { CassieJobQueue } from "../packages/jobs/queue.ts";
import type { ControlRun, ExecutionJob } from "../packages/core/schemas/index.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL should rally.",
  invalidationSignals: ["ETF thesis fails."],
};

const ticket: TradeTicket = {
  ticketId: "ticket_1",
  runId: "run_1",
  userId: "user_1",
  thesis: exitPlan.thesis,
  venue: "hyperliquid",
  instrument: "SOL",
  side: "long",
  sizeUsd: 100,
  orderType: "marketable_limit",
  venueData: { symbol: "SOL" },
  exitPlan,
};

const settings: UserSettings = {
  userId: "user_1",
  privyUserId: "did:privy:user_1",
  privyWalletId: "wallet_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
  defaultTradeSizeUsd: 50,
};

const position: Position = {
  positionId: "position_1",
  userId: "user_1",
  ticketId: "ticket_1",
  executionJobId: "job_1",
  venue: "hyperliquid",
  instrument: "SOL",
  side: "long",
  status: "open",
  entrySizeUsd: 100,
  filledBaseSize: 1,
  filledSizeUsd: 100,
  entryPrice: 100,
  currentMarkPrice: 112,
  currentValueUsd: 112,
  unrealizedPnlUsd: 12,
  unrealizedPnlPct: 12,
  exitPlan,
  openedAt: "2026-05-30T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z",
  lastMarkedAt: "2026-05-31T00:00:00.000Z",
  closedAt: null,
  closeExecutionJobId: null,
  failureReason: null,
};

class FakeQueue implements CassieJobQueue {
  async enqueueExecution(job: ExecutionJob) {
    return { executionJobId: job.jobId, graphileJobId: null };
  }

  async enqueueSupervisor(run: ControlRun) {
    return { runId: run.runId, graphileJobId: null };
  }

  async enqueuePositionReview() {
    return { graphileJobId: null };
  }

  async enqueueClosePosition(input: { positionId: string }) {
    return { positionId: input.positionId, graphileJobId: "close_1" };
  }
}

describe("close positions", () => {
  it("queues and closes open positions", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addPosition(position);
    await queueClosePosition({ positionId: "position_1", store, jobQueue: new FakeQueue() });
    expect(await store.getPosition("position_1")).toMatchObject({ status: "closing" });

    const closeClient: PositionCloseClient = {
      async close() {
        return {
          venueOrderId: "close_order_1",
          filledBaseSize: 1,
          filledSizeUsd: 112,
          averagePrice: 112,
        };
      },
    };
    const walletGateway = {
      refundUserUsdcFromTreasury: vi.fn().mockResolvedValue({
        transferId: "refund_1",
        referenceId: "position_close:position_1",
        status: "succeeded",
        sourceWalletId: "treasury_wallet",
        destinationAddress: settings.walletAddress!,
        amountUsd: 112,
        asset: "usdc",
        chain: "base",
        createdAt: "2026-05-31T00:00:00.000Z",
        raw: {},
      }),
    };
    const closed = await executeClosePosition({ positionId: "position_1", store, closeClient, walletGateway });

    expect(closed).toMatchObject({
      status: "closed",
      closeExecutionJobId: "close_order_1",
      currentValueUsd: 0,
      unrealizedPnlUsd: 12,
      unrealizedPnlPct: 12,
    });
    expect(walletGateway.refundUserUsdcFromTreasury).toHaveBeenCalledWith({
      userWalletAddress: settings.walletAddress,
      amountUsd: 112,
      referenceId: "position_close:position_1",
    });
  });

  it("surfaces close failures on the position", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addPosition({ ...position, status: "closing" });
    const closeClient: PositionCloseClient = {
      async close() {
        throw new Error("venue rejected reduce-only order");
      },
    };

    const failed = await executeClosePosition({ positionId: "position_1", store, closeClient });

    expect(failed).toMatchObject({
      status: "close_failed",
      failureReason: "venue rejected reduce-only order",
    });
  });

  it("does not mark the position closed when the close refund fails", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addPosition({ ...position, status: "closing" });
    const closeClient: PositionCloseClient = {
      async close() {
        return {
          venueOrderId: "close_order_1",
          filledBaseSize: 1,
          filledSizeUsd: 112,
          averagePrice: 112,
        };
      },
    };

    const failed = await executeClosePosition({
      positionId: "position_1",
      store,
      closeClient,
      walletGateway: {
        async refundUserUsdcFromTreasury() {
          throw new Error("treasury transfer failed");
        },
      },
    });

    expect(failed).toMatchObject({
      status: "close_failed",
      closedAt: null,
      failureReason: "treasury transfer failed",
    });
  });

  it("does not mark the position closed or refund when the venue only partially closes", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addPosition({ ...position, status: "closing" });
    const closeClient: PositionCloseClient = {
      async close() {
        return {
          venueOrderId: "partial_close_order_1",
          filledBaseSize: 0.4,
          filledSizeUsd: 44.8,
          averagePrice: 112,
        };
      },
    };
    const walletGateway = {
      refundUserUsdcFromTreasury: vi.fn(),
    };

    const failed = await executeClosePosition({ positionId: "position_1", store, closeClient, walletGateway });

    expect(failed).toMatchObject({
      status: "close_failed",
      closedAt: null,
      failureReason: "Position close filled 0.4 base units, expected 1.",
    });
    expect(walletGateway.refundUserUsdcFromTreasury).not.toHaveBeenCalled();
  });
});
