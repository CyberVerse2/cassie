import { config } from "../core/config.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import { MissingConnectorConfigError } from "../core/helpers/connector-errors.ts";
import type { ExecutionFundingSource, ExecutionJob, TradeTicket, UserSettings } from "../core/schemas/index.ts";
import { PrivyAdapter, type PrivyWalletGateway } from "../adapters/privy/index.ts";
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
  walletGateway?: Pick<PrivyWalletGateway, "getUsdcBalanceUsd">;
}): Promise<ExecutionJob> {
  const store = input.store ?? new DrizzleCassieStore();
  const jobToRun = await store.getExecutionJob(input.jobId);

  if (!jobToRun) {
    throw new Error(`Execution job ${input.jobId} was not found.`);
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

  try {
    const settings = await requiredUserSettings(store, ticket.userId);
    funding = await reservePermissionedWalletSpend({
      store,
      walletGateway,
      settings,
      ticket,
      job,
    });
    reservationOpen = true;
    reservedWalletBalanceUsd = await walletGateway.getUsdcBalanceUsd(funding.privyWalletId);
    const executionResult = await executionClient.execute(ticket, { funding });
    await store.settleWalletSpend({
      ticket,
      job,
      executionResult,
      walletBalanceUsd: reservedWalletBalanceUsd,
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
    if (reservationOpen && funding && reservedWalletBalanceUsd != null) {
      await store.releaseWalletSpend({
        ticket,
        job,
        reason: error instanceof Error ? error.message : String(error),
        walletBalanceUsd: reservedWalletBalanceUsd,
      });
    }
    job = await store.updateExecutionJob(
      markExecutionFailed(job, error instanceof Error ? error.message : String(error)),
    );
    await auditExecutionFailure(store, job);
    throw error;
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
    throw new MissingConnectorConfigError("Permissioned user-wallet execution", "EXECUTION_WEBHOOK_URL");
  }
  return new WebhookExecutionClient();
}

async function requiredUserSettings(store: CassieStore, userId: string): Promise<UserSettings> {
  const settings = await store.getUserSettings(userId);
  if (!settings) {
    throw new Error(`User settings were not found for ${userId}.`);
  }
  if (!settings.privyWalletId || !settings.walletAddress) {
    throw new Error("Trade execution requires a delegated Privy user wallet.");
  }
  return settings;
}

async function reservePermissionedWalletSpend(input: {
  store: CassieStore;
  walletGateway: Pick<PrivyWalletGateway, "getUsdcBalanceUsd">;
  settings: UserSettings;
  ticket: TradeTicket;
  job: ExecutionJob;
}): Promise<ExecutionFundingSource> {
  const walletBalanceUsd = await input.walletGateway.getUsdcBalanceUsd(input.settings.privyWalletId!);
  await input.store.reserveWalletSpend({
    ticket: input.ticket,
    job: input.job,
    walletBalanceUsd,
  });
  return {
    type: "privy_user_wallet",
    userId: input.ticket.userId,
    privyWalletId: input.settings.privyWalletId!,
    walletAddress: input.settings.walletAddress!,
    amountUsd: input.ticket.sizeUsd,
  };
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
