import { randomUUID } from "node:crypto";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import {
  TradeTicketSchema,
  type Chain,
  type ExecutionFundingSource,
  type ExecutionJob,
  type Position,
  type TradeTicket,
  type UserSettings,
} from "../core/schemas/index.ts";
import { CircleWalletAdapter } from "../adapters/circle/index.ts";
import { notarizeOpenedPosition } from "../app/trade-notary.ts";
import { PrivyAdapter } from "../adapters/privy/index.ts";
import type { UsdcTransfer, WalletGateway } from "../adapters/wallet/gateway.ts";
import { FundingRouter, venueChainForTicket } from "../execution/funding-router.ts";
import {
  VenueExecutionClient,
  type ExecutionClient,
} from "../execution/index.ts";
import { SimulatedExecutionClient } from "../execution/simulated.ts";
import { config } from "../core/config.ts";
import {
  formatExecutionFailed,
  formatTradeExecuted,
  notifyTradeLifecycle,
} from "../notifications/positions.ts";
import { notifyXTradeShare, type XReplyClient } from "../notifications/x.ts";
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
  getExecutionClient?: () => ExecutionClient;
  walletGateway?: Pick<
    WalletGateway,
    "getUsdcBalanceUsd" | "getTreasuryWalletAddress" | "transferUserUsdcToTreasury" | "refundUserUsdcFromTreasury"
  >;
  fundingRouter?: Pick<FundingRouter, "ensureVenueUsdc">;
  xReplyClient?: XReplyClient;
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
  let walletGateway = input.walletGateway ?? null;
  let spendWallet: SpendWallet | null = null;
  let funding: ExecutionFundingSource | null = null;
  let reservedWalletBalanceUsd: number | null = null;
  let reservationOpen = false;
  let prefundTransfer: UsdcTransfer | null = null;
  let executionResult: NonNullable<ExecutionJob["executionResult"]> | null = null;
  let settings: UserSettings | null = null;

  try {
    validateExecutableTicket(ticket);
    const executionClient = input.executionClient ?? (input.getExecutionClient ?? defaultExecutionClient)();
    settings = await requiredUserSettings(store, ticket.userId);
    spendWallet = await resolveSpendWallet(store, settings);
    walletGateway ??= spendWallet.mode === "privy_wallet"
      ? new PrivyAdapter()
      : new CircleWalletAdapter();
    const walletBalanceUsd = await walletGateway.getUsdcBalanceUsd({
      walletId: spendWallet.walletId,
    });
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
      spendWallet,
      ticket,
      job,
      walletBalanceUsd,
    });
    funding = prefund.funding;
    prefundTransfer = prefund.transfer;
    if (prefundTransfer.status !== "succeeded") {
      throw new Error(`USDC prefund ${prefundTransfer.transferId} did not confirm before execution: ${prefundTransfer.status}.`);
    }
    if (spendWallet.mode === "circle_wallet") {
      if (config.execution.simulated) {
        funding = { ...funding, venueChain: venueChainForTicket(ticket) };
      } else {
        const fundingRouter = input.fundingRouter ?? new FundingRouter();
        const venue = await fundingRouter.ensureVenueUsdc({ store, ticket, job });
        funding = { ...funding, venueChain: venue.venueChain };
      }
    }
    executionResult = await executionClient.execute(ticket, { funding });
    const releaseUsd = unfilledTicketSizeUsd(ticket, executionResult);
    const releaseTransfer = releaseUsd > 0
      ? await walletGateway.refundUserUsdcFromTreasury({
        userWalletAddress: spendWallet.address,
        amountUsd: releaseUsd,
        referenceId: `trade_release:${job.jobId}`,
        chain: spendWallet.chain,
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
    const position = await createPositionForFilledExecution({ store, ticket, job, executionResult });
    await store.audit({
      entityId: job.jobId,
      entityType: "execution_job",
      eventType: "execution_job.succeeded",
      message: "Execution job succeeded.",
      data: executionResult,
    });
    await notifyTradeLifecycle({
      store,
      settings: settings ?? await requiredUserSettings(store, ticket.userId),
      text: formatTradeExecuted({ ticket, job, position }),
      entityId: job.jobId,
      eventType: "telegram.trade_executed_failed",
    });
    await notifyXTradeShare({
      store,
      run: ticket.runId ? await store.getRun(ticket.runId) : undefined,
      position,
      replyClient: input.xReplyClient,
    });
    return job;
  } catch (error) {
    let failureReason = error instanceof Error ? error.message : String(error);
    if (reservationOpen && reservedWalletBalanceUsd != null && !executionResult) {
      const refundTransfer = prefundTransfer?.status === "succeeded" && walletGateway && spendWallet
        ? await refundPrefundedSpend({
          walletGateway,
          spendWallet,
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
    const failureSettings = settings ?? await store.getUserSettings(ticket.userId);
    if (failureSettings) {
      await notifyTradeLifecycle({
        store,
        settings: failureSettings,
        text: formatExecutionFailed({ ticket, job }),
        entityId: job.jobId,
        eventType: "telegram.execution_failed_failed",
      });
    }
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
  return config.execution.simulated
    ? new SimulatedExecutionClient()
    : new VenueExecutionClient();
}

function validateExecutableTicket(ticket: TradeTicket): void {
  const parsed = TradeTicketSchema.safeParse(ticket);
  if (!parsed.success) {
    const exitPlanError = parsed.error.issues.find((issue) => issue.path[0] === "exitPlan");
    if (exitPlanError) {
      throw new Error("Trade execution requires a valid exit plan.");
    }
    throw parsed.error;
  }
}

async function createPositionForFilledExecution(input: {
  store: CassieStore;
  ticket: TradeTicket;
  job: ExecutionJob;
  executionResult: NonNullable<ExecutionJob["executionResult"]>;
}): Promise<Position | null> {
  if (input.executionResult.filledSizeUsd <= 0) {
    return null;
  }

  const existing = await input.store.getPositionByExecutionJob(input.job.jobId);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const position: Position = {
    positionId: randomUUID(),
    userId: input.ticket.userId,
    ticketId: input.ticket.ticketId,
    executionJobId: input.job.jobId,
    venue: input.ticket.venue,
    instrument: input.ticket.instrument,
    side: input.ticket.side,
    status: "open",
    entrySizeUsd: input.ticket.sizeUsd,
    filledBaseSize: input.executionResult.filledBaseSize && input.executionResult.filledBaseSize > 0
      ? input.executionResult.filledBaseSize
      : null,
    filledSizeUsd: input.executionResult.filledSizeUsd,
    entryPrice: input.executionResult.averagePrice,
    currentMarkPrice: input.executionResult.averagePrice,
    currentValueUsd: input.executionResult.filledSizeUsd,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    exitPlan: input.ticket.exitPlan,
    openedAt: now,
    updatedAt: now,
    lastMarkedAt: input.executionResult.averagePrice == null ? null : now,
    closedAt: null,
    closeExecutionJobId: null,
    failureReason: null,
  };

  const stored = await input.store.addPosition(position);
  // Fire-and-forget: the on-chain receipt must never block or fail the fill.
  notarizeOpenedPosition({
    store: input.store,
    ticket: input.ticket,
    position: stored,
  });
  return stored;
}

async function requiredUserSettings(store: CassieStore, userId: string): Promise<UserSettings> {
  const settings = await store.getUserSettings(userId);
  if (!settings) {
    throw new Error(`User settings were not found for ${userId}.`);
  }
  return settings;
}

// The wallet a trade spends from: a legacy Privy embedded wallet on Base, or
// the user's Circle deposit wallet on the default (Arc) chain. Prefunds move
// USDC from this wallet into the treasury; refunds and payouts move it back.
type SpendWallet = {
  mode: "privy_wallet" | "circle_wallet";
  walletId: string;
  address: string;
  chain: Chain;
};

async function resolveSpendWallet(
  store: CassieStore,
  settings: UserSettings,
): Promise<SpendWallet> {
  // The Circle deposit wallet is the canonical money layer; legacy Privy
  // wallets are only used when no deposit wallet exists.
  const deposit = await store.getDepositAddress(settings.userId);
  if (deposit) {
    return {
      mode: "circle_wallet",
      walletId: deposit.circleWalletId,
      address: deposit.evmAddress,
      chain: config.circle.defaultChain,
    };
  }
  if (settings.privyWalletId && settings.walletAddress) {
    return {
      mode: "privy_wallet",
      walletId: settings.privyWalletId,
      address: settings.walletAddress,
      chain: "base",
    };
  }
  throw new Error("Trade execution requires a signer-provisioned Privy user wallet or a funded deposit address.");
}

async function prefundTreasurySpend(input: {
  store: CassieStore;
  walletGateway: Pick<
    WalletGateway,
    "getTreasuryWalletAddress" | "transferUserUsdcToTreasury"
  >;
  spendWallet: SpendWallet;
  ticket: TradeTicket;
  job: ExecutionJob;
  walletBalanceUsd: number;
}): Promise<{
  funding: ExecutionFundingSource;
  transfer: UsdcTransfer;
}> {
  const transfer = await input.walletGateway.transferUserUsdcToTreasury({
    userWalletId: input.spendWallet.walletId,
    amountUsd: input.ticket.sizeUsd,
    referenceId: `trade_prefund:${input.job.jobId}`,
    chain: input.spendWallet.chain,
  });
  await input.store.recordWalletPrefund({
    ticket: input.ticket,
    job: input.job,
    amountUsd: input.ticket.sizeUsd,
    walletBalanceUsd: input.walletBalanceUsd,
    metadata: { transfer, fundingMode: input.spendWallet.mode },
  });
  return {
    funding: {
      type: "cassie_treasury",
      userId: input.ticket.userId,
      treasuryWalletAddress: input.walletGateway.getTreasuryWalletAddress(input.spendWallet.chain),
      prefundTransferId: transfer.transferId,
      prefundTransferStatus: transfer.status,
      amountUsd: input.ticket.sizeUsd,
      chain: input.spendWallet.chain,
    },
    transfer,
  };
}

async function refundPrefundedSpend(input: {
  walletGateway: Pick<WalletGateway, "refundUserUsdcFromTreasury">;
  spendWallet: SpendWallet;
  job: ExecutionJob;
  amountUsd: number;
}): Promise<UsdcTransfer | null> {
  if (input.amountUsd <= 0) return null;
  return input.walletGateway.refundUserUsdcFromTreasury({
    userWalletAddress: input.spendWallet.address,
    amountUsd: input.amountUsd,
    referenceId: `trade_refund:${input.job.jobId}`,
    chain: input.spendWallet.chain,
  });
}

function unfilledTicketSizeUsd(
  ticket: TradeTicket,
  executionResult: NonNullable<ExecutionJob["executionResult"]>,
): number {
  const ticketCents = usdToCents(ticket.sizeUsd);
  const filledCents = usdToCents(executionResult.collateralUsedUsd ?? executionResult.filledSizeUsd);
  if (filledCents < 0 || filledCents > ticketCents) {
    throw new Error("Execution result collateralUsedUsd must be between zero and the reserved ticket size.");
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
