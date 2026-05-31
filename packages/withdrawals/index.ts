import { randomUUID } from "node:crypto";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { Withdrawal } from "../core/schemas/index.ts";
import { PrivyAdapter, type PrivyWalletGateway } from "../adapters/privy/index.ts";
import { GraphileExecutionJobQueue, type CassieJobQueue } from "../jobs/queue.ts";

type WithdrawalGateway = Pick<PrivyWalletGateway, "refundUserUsdcFromTreasury">;

export async function withdrawableBalanceUsd(input: {
  store: CassieStore;
  userId: string;
  walletBalanceUsd: number;
}): Promise<number> {
  const funding = await input.store.getWalletFundingBalance(input.userId, input.walletBalanceUsd);
  const pendingWithdrawals = (await input.store.listUserWithdrawals(input.userId))
    .filter((withdrawal) => withdrawal.status === "queued" || withdrawal.status === "running")
    .reduce((total, withdrawal) => total + withdrawal.amountUsd, 0);
  return Math.max(0, roundUsd(funding.spendableUsd - pendingWithdrawals));
}

export async function queueWithdrawal(input: {
  userId: string;
  amountUsd: number;
  destinationAddress: string;
  walletBalanceUsd: number;
  store?: CassieStore;
  jobQueue?: CassieJobQueue;
}): Promise<Withdrawal> {
  const store = input.store ?? new DrizzleCassieStore();
  validateWithdrawalInput(input.amountUsd, input.destinationAddress);
  const available = await withdrawableBalanceUsd({
    store,
    userId: input.userId,
    walletBalanceUsd: input.walletBalanceUsd,
  });
  if (input.amountUsd > available) {
    throw new Error(`Withdrawal amount $${input.amountUsd.toFixed(2)} exceeds withdrawable balance $${available.toFixed(2)}.`);
  }
  const now = new Date().toISOString();
  const withdrawal = await store.addWithdrawal({
    withdrawalId: randomUUID(),
    userId: input.userId,
    amountUsd: input.amountUsd,
    destinationAddress: input.destinationAddress,
    status: "queued",
    transferId: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  const jobQueue = input.jobQueue ?? new GraphileExecutionJobQueue();
  const queued = await jobQueue.enqueueWithdrawal({ withdrawalId: withdrawal.withdrawalId });
  await store.audit({
    entityId: withdrawal.withdrawalId,
    entityType: "withdrawal",
    eventType: "withdrawal.queued",
    message: "Withdrawal queued.",
    data: { graphileJobId: queued.graphileJobId },
  });
  return withdrawal;
}

export async function executeWithdrawal(input: {
  withdrawalId: string;
  store?: CassieStore;
  walletGateway?: WithdrawalGateway;
}): Promise<Withdrawal> {
  const store = input.store ?? new DrizzleCassieStore();
  const gateway = input.walletGateway ?? new PrivyAdapter();
  const withdrawal = await store.getWithdrawal(input.withdrawalId);
  if (!withdrawal) throw new Error(`Withdrawal ${input.withdrawalId} was not found.`);
  if (withdrawal.status === "succeeded" || withdrawal.status === "failed") return withdrawal;

  const running = await store.updateWithdrawal({
    ...withdrawal,
    status: "running",
    updatedAt: new Date().toISOString(),
    failureReason: null,
  });

  try {
    const transfer = await gateway.refundUserUsdcFromTreasury({
      userWalletAddress: running.destinationAddress,
      amountUsd: running.amountUsd,
      referenceId: `withdrawal:${running.withdrawalId}`,
    });
    const now = new Date().toISOString();
    const succeeded = await store.updateWithdrawal({
      ...running,
      status: "succeeded",
      transferId: transfer.transferId,
      updatedAt: now,
      completedAt: now,
      failureReason: null,
    });
    await store.audit({
      entityId: succeeded.withdrawalId,
      entityType: "withdrawal",
      eventType: "withdrawal.succeeded",
      message: "Withdrawal succeeded.",
      data: transfer,
    });
    return succeeded;
  } catch (error) {
    const now = new Date().toISOString();
    const failed = await store.updateWithdrawal({
      ...running,
      status: "failed",
      updatedAt: now,
      completedAt: now,
      failureReason: error instanceof Error ? error.message : String(error),
    });
    await store.audit({
      entityId: failed.withdrawalId,
      entityType: "withdrawal",
      eventType: "withdrawal.failed",
      message: "Withdrawal failed.",
      data: { failureReason: failed.failureReason },
    });
    return failed;
  }
}

function validateWithdrawalInput(amountUsd: number, destinationAddress: string): void {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Withdrawal amount must be positive.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/u.test(destinationAddress)) {
    throw new Error("Withdrawal destination must be a valid EVM address.");
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
