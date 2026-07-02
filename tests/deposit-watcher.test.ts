import { describe, expect, it, vi } from "vitest";
import type { CircleIncomingTransfer } from "../packages/adapters/circle/index.ts";
import { sweepDeposit } from "../packages/app/deposit-sweeper.ts";
import { pollDeposits } from "../packages/app/deposit-watcher.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { CassieJobQueue } from "../packages/jobs/queue.ts";
import type { ControlRun, ExecutionJob } from "../packages/core/schemas/index.ts";

const depositAddress = {
  userId: "user_1",
  walletSetId: "wallet_set_1",
  circleWalletId: "circle_wallet_1",
  evmAddress: "0xAAaA111111111111111111111111111111111111",
  createdAt: "2026-07-01T00:00:00.000Z",
};

function transfer(overrides: Partial<CircleIncomingTransfer> = {}): CircleIncomingTransfer {
  return {
    transferId: "transfer_1",
    chain: "arbitrum",
    blockchain: "ARB",
    destinationAddress: depositAddress.evmAddress.toLowerCase(),
    amountUsd: 40,
    txHash: "0xhash1",
    tokenId: "usdc_token",
    state: "COMPLETE",
    createDate: "2026-07-01T01:00:00.000Z",
    ...overrides,
  };
}

class FakeQueue implements CassieJobQueue {
  sweeps: Array<{ userId: string; circleTransferId: string; amountUsd: number; chain: string | null }> = [];

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

  async enqueueSweepDeposit(input: { userId: string; circleTransferId: string; amountUsd: number; chain: string | null }) {
    this.sweeps.push(input);
    return { graphileJobId: null };
  }
}

async function storeWithUser() {
  const store = new InMemoryCassieStore();
  await store.syncXUser({
    xUserId: "x_1",
    username: "cassie",
    profile: { name: "Cassie", handle: "cassie", avatarUrl: null },
  });
  await store.addUserDepositAddress({ ...depositAddress, userId: "x:x_1" });
  return store;
}

describe("deposit watcher", () => {
  it("credits a matched USDC deposit and enqueues a sweep", async () => {
    const store = await storeWithUser();
    const jobQueue = new FakeQueue();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    const result = await pollDeposits({ store, circle, jobQueue });

    expect(result).toMatchObject({ found: 1, credited: 1, skipped: 0, unmatched: 0 });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(40);
    expect(balance.spendableUsd).toBe(40);
    expect(jobQueue.sweeps).toEqual([{
      userId: "x:x_1",
      circleTransferId: "transfer_1",
      amountUsd: 40,
      chain: "arbitrum",
    }]);
  });

  it("does not double-credit the same transfer across polls", async () => {
    const store = await storeWithUser();
    const jobQueue = new FakeQueue();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    await pollDeposits({ store, circle, jobQueue });
    const second = await pollDeposits({ store, circle, jobQueue });

    expect(second).toMatchObject({ credited: 0, skipped: 1 });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(40);
    expect(jobQueue.sweeps).toHaveLength(1);
  });

  it("does not double-credit when the ledger already has the transfer", async () => {
    const store = await storeWithUser();
    await store.recordDepositCredit({
      userId: "x:x_1",
      amountUsd: 40,
      chain: "arbitrum",
      txHash: "0xhash1",
      circleTransferId: "transfer_1",
    });
    const jobQueue = new FakeQueue();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    const result = await pollDeposits({ store, circle, jobQueue });

    expect(result).toMatchObject({ credited: 0, skipped: 1 });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(40);
    expect(jobQueue.sweeps).toHaveLength(0);
  });

  it("advances the poll cursor and passes it to Circle", async () => {
    const store = await storeWithUser();
    const jobQueue = new FakeQueue();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    await pollDeposits({ store, circle, jobQueue });
    expect(circle.listIncomingUsdcTransfers).toHaveBeenLastCalledWith({ from: undefined });

    circle.listIncomingUsdcTransfers.mockResolvedValue([]);
    await pollDeposits({ store, circle, jobQueue });
    expect(circle.listIncomingUsdcTransfers).toHaveBeenLastCalledWith({
      from: "2026-07-01T01:00:00.000Z",
    });
  });

  it("counts transfers to unknown addresses as unmatched", async () => {
    const store = await storeWithUser();
    const jobQueue = new FakeQueue();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([
        transfer({ destinationAddress: "0xbbbb222222222222222222222222222222222222" }),
      ]),
    };

    const result = await pollDeposits({ store, circle, jobQueue });

    expect(result).toMatchObject({ credited: 0, unmatched: 1 });
    expect(jobQueue.sweeps).toHaveLength(0);
  });
});

describe("deposit sweeper", () => {
  it("sweeps a credited deposit to the treasury exactly once", async () => {
    const store = await storeWithUser();
    const circle = {
      transferUserUsdcToTreasury: vi.fn().mockResolvedValue({
        transferId: "sweep_tx_1",
        referenceId: "deposit_sweep:transfer_1",
        status: "succeeded",
        sourceWalletId: "circle_wallet_1",
        destinationAddress: "0xtreasury",
        amountUsd: 40,
        asset: "usdc",
        chain: "arbitrum",
        createdAt: "2026-07-01T02:00:00.000Z",
        raw: {},
      }),
    };
    const payload = {
      userId: "x:x_1",
      circleTransferId: "transfer_1",
      amountUsd: 40,
      chain: "arbitrum",
    };

    const first = await sweepDeposit({ payload, store, circle });
    const second = await sweepDeposit({ payload, store, circle });

    expect(first.status).toBe("swept");
    expect(second.status).toBe("duplicate");
    expect(circle.transferUserUsdcToTreasury).toHaveBeenCalledTimes(1);
    expect(circle.transferUserUsdcToTreasury).toHaveBeenCalledWith({
      userWalletId: "circle_wallet_1",
      amountUsd: 40,
      referenceId: "deposit_sweep:transfer_1",
      chain: "arbitrum",
    });
    // Sweeps are treasury ops: they must not change the user's balance.
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(0);
  });
});
