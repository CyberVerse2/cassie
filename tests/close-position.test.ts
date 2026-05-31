import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { Position, TradeExitPlan, TradeTicket } from "../packages/core/schemas/index.ts";
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

  async enqueueWithdrawal(input: { withdrawalId: string }) {
    return { withdrawalId: input.withdrawalId, graphileJobId: null };
  }
}

describe("close positions", () => {
  it("queues and closes open positions", async () => {
    const store = new InMemoryCassieStore();
    await store.addTradeTicket(ticket);
    await store.addPosition(position);
    await queueClosePosition({ positionId: "position_1", store, jobQueue: new FakeQueue() });
    expect(await store.getPosition("position_1")).toMatchObject({ status: "closing" });

    const closeClient: PositionCloseClient = {
      async close() {
        return {
          venueOrderId: "close_order_1",
          filledSizeUsd: 112,
          averagePrice: 112,
        };
      },
    };
    const closed = await executeClosePosition({ positionId: "position_1", store, closeClient });

    expect(closed).toMatchObject({
      status: "closed",
      closeExecutionJobId: "close_order_1",
      currentValueUsd: 0,
    });
  });

  it("surfaces close failures on the position", async () => {
    const store = new InMemoryCassieStore();
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
});
