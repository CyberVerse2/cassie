import { config } from "../core/config.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import { MissingConnectorConfigError } from "../core/helpers/connector-errors.ts";
import type { ExecutionFundingSource, ExecutionJob, TradeTicket, UserSettings } from "../core/schemas/index.ts";
import { PrivyAdapter, type PrivyWalletGateway, type WalletUsdcTransfer } from "../adapters/privy/index.ts";
import {
  WebhookExecutionClient,
  type ExecutionClient,
} from "../execution/index.ts";
import { GraphileExecutionJobQueue, type CassieJobQueue } from "./queue.ts";
import {
  createQueuedExecutionJob,
  markExecutionFailed,
  markExecutionRunning,
  markExecutionSucceeded,
} from "./state.ts";

export async function executeExecutionJob(input: {
  jobId: string;
  store?: CassieStore;
  executionClient?: ExecutionClient;
  walletGateway?: Pick<
    PrivyWalletGateway,
    "getUsdcBalanceUsd" | "getTreasuryWalletAddress" | "transferUserUsdcToTreasury" | "refundUserUsdcFromTreasury"
  >;
}): Promise<ExecutionJob> {
  const store = input.store ?? new DrizzleCassieStore();
  const jobToRun = await store.getExecutionJob(input.jobId);

  if (!jobToRun) {
    throw new Error(`Execution job ${input.jobId} was not found.`);
  }
  if (jobToRun.status === "succeeded" || jobToRun.status === "failed") {
    return jobToRun;
  }

  const ticket = await store.getTradeTicket(jobToRun.ticketId);
  if (!ticket) {
    const failed = await store.updateExecutionJob(
      markExecutionFailed(jobToRun, "Execution ticket was not found."),
    );
    await auditExecutionFailure(store, failed);
    return failed;
  }

  let job = await store.updateExecutionJob(markExecutionRunning(jobToRun));
  const executionClient = input.executionClient ?? defaultExecutionClient();
  const walletGateway = input.walletGateway ?? new PrivyAdapter();
  let funding: ExecutionFundingSource | null = null;
  let reservedWalletBalanceUsd: number | null = null;
  let reservationOpen = false;
  let prefundTransfer: WalletUsdcTransfer | null = null;
  let executionResult: NonNullable<ExecutionJob["executionResult"]> | null = null;
  let settings: UserSettings | null = null;

  try {
    settings = await requiredUserSettings(store, ticket.userId);
    const walletBalanceUsd = await walletGateway.getUsdcBalanceUsd(settings.privyWalletId!);
    await store.reserveWalletSpend({
      ticket,
      job,
      walletBalanceUsd,
    });
    reservationOpen = true;
    reservedWalletBalanceUsd = walletBalanceUsd;
    const prefund = await prefundTreasurySpend({
      store,
      walletGateway,
      settings,
      ticket,
      job,
      walletBalanceUsd,
    });
    funding = prefund.funding;
    prefundTransfer = prefund.transfer;
    if (prefundTransfer.status !== "succeeded") {
      throw new Error(`Privy USDC prefund ${prefundTransfer.transferId} did not confirm before execution: ${prefundTransfer.status}.`);
    }
    executionResult = await executionClient.execute(ticket, { funding });
    const releaseUsd = unfilledTicketSizeUsd(ticket, executionResult);
    const releaseTransfer = releaseUsd > 0
      ? await walletGateway.refundUserUsdcFromTreasury({
        userWalletAddress: settings.walletAddress!,
        amountUsd: releaseUsd,
        referenceId: `trade_release:${job.jobId}`,
      })
      : null;
    await store.settleWalletSpend({
      ticket,
      job,
      executionResult,
      walletBalanceUsd: reservedWalletBalanceUsd,
      releaseMetadata: releaseTransfer
        ? { reason: "unfilled_order_amount", transfer: releaseTransfer }
        : undefined,
    });
    reservationOpen = false;
    job = await store.updateExecutionJob(markExecutionSucceeded(job, executionResult));
    await store.audit({
      entityId: job.jobId,
      entityType: "execution_job",
      eventType: "execution_job.succeeded",
      message: "Execution job succeeded.",
      data: executionResult,
    });
    return job;
  } catch (error) {
    let failureReason = error instanceof Error ? error.message : String(error);
    if (reservationOpen && reservedWalletBalanceUsd != null && !executionResult) {
      const refundTransfer = prefundTransfer?.status === "succeeded"
        ? await refundPrefundedSpend({
          walletGateway,
          settings: settings ?? await requiredUserSettings(store, ticket.userId),
          job,
          amountUsd: ticket.sizeUsd,
        }).catch((refundError) => {
          failureReason = `${failureReason}; refund failed: ${refundError instanceof Error ? refundError.message : String(refundError)}`;
          return null;
        })
        : null;
      if (!prefundTransfer || refundTransfer) {
        await store.releaseWalletSpend({
          ticket,
          job,
          reason: failureReason,
          walletBalanceUsd: reservedWalletBalanceUsd,
          metadata: refundTransfer
            ? { reason: failureReason, transfer: refundTransfer }
            : { reason: failureReason },
        });
      }
    }
    job = await store.updateExecutionJob(
      markExecutionFailed(job, failureReason),
    );
    await auditExecutionFailure(store, job);
    return job;
  }
}

export async function enqueueTradeTicketsForRun(input: {
  runId: string;
  store?: CassieStore;
  jobQueue?: CassieJobQueue;
}): Promise<{ enqueued: number; ticketIds: string[] }> {
  const store = input.store ?? new DrizzleCassieStore();
  const jobQueue = input.jobQueue ?? new GraphileExecutionJobQueue();
  const tickets = await store.listTradeTicketsWithoutExecutionJob(input.runId);

  const ticketIds: string[] = [];
  for (const ticket of tickets) {
    await queueExecutionJob({
      store,
      jobQueue,
      ticket,
      message: "Trade ticket queued for execution.",
      data: { runId: input.runId },
    });
    ticketIds.push(ticket.ticketId);
  }

  return { enqueued: ticketIds.length, ticketIds };
}

export async function queueExecutionJob(input: {
  store: CassieStore;
  jobQueue: CassieJobQueue;
  ticket: TradeTicket;
  message: string;
  data?: Record<string, unknown>;
}): Promise<ExecutionJob> {
  const job = await input.store.addExecutionJob(createQueuedExecutionJob(input.ticket.ticketId));
  const queued = await input.jobQueue.enqueueExecution(job);
  await input.store.audit({
    entityId: job.jobId,
    entityType: "execution_job",
    eventType: "execution_job.queued",
    message: input.message,
    data: {
      ...input.data,
      ticketId: input.ticket.ticketId,
      graphileJobId: queued.graphileJobId,
    },
  });
  return job;
}

function defaultExecutionClient(): ExecutionClient {
  if (!config.execution.webhookUrl) {
    throw new MissingConnectorConfigError("Treasury execution", "EXECUTION_WEBHOOK_URL");
  }
  return new WebhookExecutionClient();
}

async function requiredUserSettings(store: CassieStore, userId: string): Promise<UserSettings> {
  const settings = await store.getUserSettings(userId);
  if (!settings) {
    throw new Error(`User settings were not found for ${userId}.`);
  }
  if (!settings.privyWalletId || !settings.walletAddress) {
    throw new Error("Trade execution requires a signer-provisioned Privy user wallet.");
  }
  return settings;
}

async function prefundTreasurySpend(input: {
  store: CassieStore;
  walletGateway: Pick<
    PrivyWalletGateway,
    "getTreasuryWalletAddress" | "transferUserUsdcToTreasury"
  >;
  settings: UserSettings;
  ticket: TradeTicket;
  job: ExecutionJob;
  walletBalanceUsd: number;
}): Promise<{
  funding: ExecutionFundingSource;
  transfer: WalletUsdcTransfer;
}> {
  const transfer = await input.walletGateway.transferUserUsdcToTreasury({
    userWalletId: input.settings.privyWalletId!,
    amountUsd: input.ticket.sizeUsd,
    referenceId: `trade_prefund:${input.job.jobId}`,
  });
  await input.store.recordWalletPrefund({
    ticket: input.ticket,
    job: input.job,
    amountUsd: input.ticket.sizeUsd,
    walletBalanceUsd: input.walletBalanceUsd,
    metadata: { transfer },
  });
  return {
    funding: {
      type: "cassie_treasury",
      userId: input.ticket.userId,
      treasuryWalletAddress: input.walletGateway.getTreasuryWalletAddress(),
      prefundTransferId: transfer.transferId,
      prefundTransferStatus: transfer.status,
      amountUsd: input.ticket.sizeUsd,
    },
    transfer,
  };
}

async function refundPrefundedSpend(input: {
  walletGateway: Pick<PrivyWalletGateway, "refundUserUsdcFromTreasury">;
  settings: UserSettings;
  job: ExecutionJob;
  amountUsd: number;
}): Promise<WalletUsdcTransfer | null> {
  if (input.amountUsd <= 0) return null;
  if (!input.settings.walletAddress) {
    throw new Error("Cannot refund prefunded spend without a user wallet address.");
  }
  return input.walletGateway.refundUserUsdcFromTreasury({
    userWalletAddress: input.settings.walletAddress,
    amountUsd: input.amountUsd,
    referenceId: `trade_refund:${input.job.jobId}`,
  });
}

function unfilledTicketSizeUsd(
  ticket: TradeTicket,
  executionResult: NonNullable<ExecutionJob["executionResult"]>,
): number {
  const ticketCents = usdToCents(ticket.sizeUsd);
  const filledCents = usdToCents(executionResult.filledSizeUsd);
  if (filledCents < 0 || filledCents > ticketCents) {
    throw new Error("Execution result filledSizeUsd must be between zero and the reserved ticket size.");
  }
  return (ticketCents - filledCents) / 100;
}

function usdToCents(amountUsd: number): number {
  if (!Number.isFinite(amountUsd)) {
    throw new Error("USD amount must be finite.");
  }
  return Math.round(amountUsd * 100);
}

async function auditExecutionFailure(store: CassieStore, job: ExecutionJob): Promise<void> {
  await store.audit({
    entityId: job.jobId,
    entityType: "execution_job",
    eventType: "execution_job.failed",
    message: "Execution job failed.",
    data: { failureReason: job.failureReason },
  });
}
