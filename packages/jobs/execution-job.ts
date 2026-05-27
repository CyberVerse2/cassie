import { config } from "../core/config.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { ExecutionJob, MarketCandidate, TradeTicket } from "../core/schemas/index.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../adapters/hyperliquid/account-state.ts";
import {
  VenueExecutionClient,
  WebhookExecutionClient,
  type ExecutionClient,
} from "../execution/index.ts";
import { evaluateRisk } from "../risk/index.ts";
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
  accountStateProvider?: AccountStateProvider;
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

  try {
    await preflightExecution({
      store,
      ticket,
      accountStateProvider: input.accountStateProvider,
    });
    const executionResult = await executionClient.execute(ticket);
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

async function preflightExecution(input: {
  store: CassieStore;
  ticket: TradeTicket;
  accountStateProvider?: AccountStateProvider;
}): Promise<void> {
  const userSettings = await input.store.getUserSettings(input.ticket.userId);
  if (!userSettings) {
    throw new Error(`No Cassie settings found for user ${input.ticket.userId}.`);
  }

  const accountState = await (input.accountStateProvider ?? new HyperliquidAccountStateProvider())
    .getAccountState(userSettings);
  const decision = evaluateRisk({
    marketSelection: {
      decision: "select_market",
      selectedMarket: ticketToMarketCandidate(input.ticket),
      selectedCandidateId: null,
      rejectionReason: null,
      rankedCandidates: [],
      rejectedCandidates: [],
      noTradeReason: null,
    },
    userSettings,
    accountState,
    sizeUsd: input.ticket.sizeUsd,
  });

  if (decision.decision === "reject") {
    throw new Error(decision.reason);
  }
}

function ticketToMarketCandidate(ticket: TradeTicket): MarketCandidate {
  const side = parseMarketSide(ticket.side);
  const symbol = ticket.venueData?.symbol ?? ticket.instrument;

  if (!symbol) {
    throw new Error("Execution preflight requires a market symbol.");
  }

  return {
    venue: ticket.venue,
    instrument: ticket.instrument,
    side,
    symbol,
    conditionId: ticket.venueData?.conditionId ?? null,
    outcomeTokenId: ticket.venueData?.outcomeTokenId ?? null,
    yesOutcomeTokenId: null,
    noOutcomeTokenId: null,
    marketQuestion: null,
    marketSlug: null,
    outcome: null,
    yesPrice: null,
    noPrice: null,
    heldSidePrice: null,
    volumeUsd: null,
    liquidityUsd: null,
    endDate: null,
    warnings: [],
    markPrice: ticket.venueData?.markPrice ?? null,
    liquidityScore: 1,
    spreadBps: ticket.venueData?.spreadBps ?? 0,
    estimatedSlippageBps: ticket.venueData?.estimatedSlippageBps ?? 0,
    minOrderSizeUsd: ticket.venueData?.minOrderSizeUsd ?? 0,
    thesisFit: 1,
    reason: "Execution preflight candidate reconstructed from trade ticket.",
  };
}

function parseMarketSide(side: string): MarketCandidate["side"] {
  if (
    side === "long" ||
    side === "short" ||
    side === "buy_yes" ||
    side === "buy_no" ||
    side === "buy" ||
    side === "sell"
  ) {
    return side;
  }

  throw new Error(`Unsupported ticket side for execution preflight: ${side}`);
}

function defaultExecutionClient(): ExecutionClient {
  return config.execution.webhookUrl
    ? new WebhookExecutionClient()
    : new VenueExecutionClient();
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
