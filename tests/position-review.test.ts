import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { ControlRun, ExecutionJob, Position, TradeExitPlan, TradeTicket, UserSettings } from "../packages/core/schemas/index.ts";
import { reviewOpenPositionsForUser } from "../packages/positions/review.ts";
import type { PositionMarkProvider } from "../packages/positions/marks.ts";
import type { CassieJobQueue } from "../packages/jobs/queue.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL should rally.",
  invalidationSignals: ["ETF thesis fails."],
};

const settings: UserSettings = {
  userId: "user_1",
  privyUserId: "did:privy:user_1",
  privyWalletId: "wallet_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
  defaultTradeSizeUsd: 50,
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
  currentMarkPrice: 100,
  currentValueUsd: 100,
  unrealizedPnlUsd: 0,
  unrealizedPnlPct: 0,
  exitPlan,
  openedAt: "2026-05-30T00:00:00.000Z",
  updatedAt: "2026-05-30T00:00:00.000Z",
  lastMarkedAt: "2026-05-30T00:00:00.000Z",
  closedAt: null,
  closeExecutionJobId: null,
  failureReason: null,
};

class FakeQueue implements CassieJobQueue {
  enqueueClosePosition = vi.fn(async (input: { positionId: string }) => ({
    positionId: input.positionId,
    graphileJobId: "close_1",
  }));

  async enqueueExecution(job: ExecutionJob) {
    return { executionJobId: job.jobId, graphileJobId: null };
  }

  async enqueueSupervisor(run: ControlRun) {
    return { runId: run.runId, graphileJobId: null };
  }

  async enqueuePositionReview() {
    return { graphileJobId: null };
  }

  async enqueueSweepDeposit(input: { userId: string; circleTransferId: string; amountUsd: number; chain: string | null }) {
    void input;
    return { graphileJobId: null };
  }
}

describe("position reviews", () => {
  it("marks open positions, updates P/L, and records exit signals", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addPosition(position);
    const markProvider: PositionMarkProvider = {
      async markPosition() {
        return {
          markPrice: 112,
          currentValueUsd: 112,
          markedAt: "2026-05-31T00:00:00.000Z",
        };
      },
    };
    const jobQueue = new FakeQueue();

    const result = await reviewOpenPositionsForUser({
      userId: "user_1",
      store,
      markProvider,
      jobQueue,
      notify: false,
    });

    expect(result).toMatchObject({ reviewed: 1, succeeded: 1, failed: 0 });
    expect(await store.getPosition("position_1")).toMatchObject({
      currentMarkPrice: 112,
      currentValueUsd: 112,
      unrealizedPnlUsd: 12,
      unrealizedPnlPct: 12,
      status: "closing",
    });
    expect(await store.getLatestPositionReview("position_1")).toMatchObject({
      status: "succeeded",
      exitSignal: "take_profit",
      summary: "SOL long triggered take profit at +12.00% unrealized P/L. Close queued.",
    });
    expect(jobQueue.enqueueClosePosition).toHaveBeenCalledWith({ positionId: "position_1" });
  });

  it("queues automatic close when stop loss is hit", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addPosition(position);
    const jobQueue = new FakeQueue();
    const markProvider: PositionMarkProvider = {
      async markPosition() {
        return {
          markPrice: 94,
          currentValueUsd: 94,
          markedAt: "2026-05-31T00:00:00.000Z",
        };
      },
    };

    await reviewOpenPositionsForUser({
      userId: "user_1",
      store,
      markProvider,
      jobQueue,
      notify: false,
    });

    expect(await store.getPosition("position_1")).toMatchObject({
      status: "closing",
      unrealizedPnlUsd: -6,
      unrealizedPnlPct: -6,
    });
    expect(await store.getLatestPositionReview("position_1")).toMatchObject({
      status: "succeeded",
      exitSignal: "stop_loss",
      summary: "SOL long triggered stop loss at -6.00% unrealized P/L. Close queued.",
    });
    expect(jobQueue.enqueueClosePosition).toHaveBeenCalledWith({ positionId: "position_1" });
  });

  it("records failed reviews without changing the last mark", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addPosition(position);
    const markProvider: PositionMarkProvider = {
      async markPosition() {
        throw new Error("venue unavailable");
      },
    };

    await reviewOpenPositionsForUser({
      userId: "user_1",
      store,
      markProvider,
      notify: false,
    });

    expect(await store.getPosition("position_1")).toMatchObject({
      currentMarkPrice: 100,
      unrealizedPnlUsd: 0,
    });
    expect(await store.getLatestPositionReview("position_1")).toMatchObject({
      status: "failed",
      failureReason: "venue unavailable",
    });
  });
});
