import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { ControlRun, ExecutionJob, TradeExitPlan, TradeTicket } from "../packages/core/schemas/index.ts";
import type { CassieJobQueue } from "../packages/jobs/queue.ts";
import { createQueuedExecutionJob } from "../packages/jobs/state.ts";
import { executeWithdrawal, queueWithdrawal, withdrawableBalanceUsd } from "../packages/withdrawals/index.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL should rally.",
  invalidationSignals: ["ETF thesis fails."],
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
    return { positionId: input.positionId, graphileJobId: null };
  }

  async enqueueWithdrawal(input: { withdrawalId: string }) {
    return { withdrawalId: input.withdrawalId, graphileJobId: "withdrawal_1" };
  }
}

describe("withdrawals", () => {
  it("subtracts reservations and pending withdrawals from withdrawable balance", async () => {
    const store = new InMemoryCassieStore();
    const ticket: TradeTicket = {
      ticketId: "ticket_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "SOL should rally.",
      venue: "hyperliquid",
      instrument: "SOL",
      side: "long",
      sizeUsd: 40,
      orderType: "marketable_limit",
      venueData: { symbol: "SOL" },
      exitPlan,
    };
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    await store.reserveWalletSpend({ ticket, job, walletBalanceUsd: 100 });
    await store.addWithdrawal({
      withdrawalId: "withdrawal_existing",
      userId: "user_1",
      amountUsd: 10,
      destinationAddress: "0x2222222222222222222222222222222222222222",
      status: "queued",
      transferId: null,
      failureReason: null,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      completedAt: null,
    });

    await expect(queueWithdrawal({
      userId: "user_1",
      amountUsd: 60,
      destinationAddress: "0x3333333333333333333333333333333333333333",
      walletBalanceUsd: 100,
      store,
      jobQueue: new FakeQueue(),
    })).rejects.toThrow("exceeds withdrawable balance $50.00");
    expect(await withdrawableBalanceUsd({ store, userId: "user_1", walletBalanceUsd: 100 })).toBe(50);
  });

  it("executes queued withdrawals through Privy settlement", async () => {
    const store = new InMemoryCassieStore();
    const withdrawal = await queueWithdrawal({
      userId: "user_1",
      amountUsd: 25,
      destinationAddress: "0x3333333333333333333333333333333333333333",
      walletBalanceUsd: 100,
      store,
      jobQueue: new FakeQueue(),
    });

    const executed = await executeWithdrawal({
      withdrawalId: withdrawal.withdrawalId,
      store,
      walletGateway: {
        async refundUserUsdcFromTreasury(input) {
          return {
            transferId: "transfer_1",
            referenceId: input.referenceId,
            status: "succeeded",
            sourceWalletId: "treasury_wallet",
            destinationAddress: input.userWalletAddress,
            amountUsd: input.amountUsd,
            asset: "usdc",
            chain: "base",
            createdAt: "2026-05-31T00:00:00.000Z",
            raw: {},
          };
        },
      },
    });

    expect(executed).toMatchObject({
      status: "succeeded",
      transferId: "transfer_1",
    });
  });
});
