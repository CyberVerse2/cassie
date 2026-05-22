import { makeWorkerUtils, run, type TaskList, type WorkerUtils } from "graphile-worker";
import { z } from "zod";
import { createPostgresPool, MissingDatabaseConfigError } from "../db/client.ts";
import { DrizzleCassieStore } from "../db/drizzle-store.ts";
import { runCassieSupervisorForRun } from "../ai/agents/supervisor/agent.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../execution/account-state.ts";
import {
  createQueuedExecutionJob,
  VenueExecutionClient,
  WebhookExecutionClient,
  markExecutionFailed,
  markExecutionRunning,
  markExecutionSucceeded,
  type ExecutionClient,
} from "../execution/index.ts";
import type { ControlRun, ExecutionJob, MarketCandidate, TradeTicket } from "../core/schemas/index.ts";
import type { CassieStore } from "../db/store.ts";
import { evaluateRisk } from "../risk/index.ts";

export const EXECUTE_TRADE_TICKET_TASK = "execute_trade_ticket";
export const RUN_CASSIE_SUPERVISOR_TASK = "run_cassie_supervisor";

const ExecuteTradeTicketPayloadSchema = z.object({
  jobId: z.string(),
});

const RunCassieSupervisorPayloadSchema = z.object({
  runId: z.string(),
});

export interface CassieJobQueue {
  enqueueExecution(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }>;
  enqueueSupervisor(run: ControlRun): Promise<{ runId: string; graphileJobId: string | null }>;
}

export interface ExecutionJobQueue {
  enqueue(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }>;
}

export class GraphileExecutionJobQueue implements CassieJobQueue {
  private workerUtils: Promise<WorkerUtils> | null = null;

  constructor(private readonly databaseUrl = process.env.DATABASE_URL) {}

  async enqueue(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }> {
    return this.enqueueExecution(job);
  }

  async enqueueExecution(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }> {
    const workerUtils = await this.getWorkerUtils();
    const graphileJob = await workerUtils.addJob(
      EXECUTE_TRADE_TICKET_TASK,
      { jobId: job.jobId },
      {
        jobKey: `cassie:execution:${job.jobId}`,
        jobKeyMode: "unsafe_dedupe",
        queueName: `cassie:ticket:${job.ticketId}`,
        maxAttempts: Number(process.env.GRAPHILE_EXECUTION_MAX_ATTEMPTS ?? 5),
      },
    );

    return { executionJobId: job.jobId, graphileJobId: graphileJob.id };
  }

  async enqueueSupervisor(run: ControlRun): Promise<{ runId: string; graphileJobId: string | null }> {
    const workerUtils = await this.getWorkerUtils();
    const graphileJob = await workerUtils.addJob(
      RUN_CASSIE_SUPERVISOR_TASK,
      { runId: run.runId },
      {
        jobKey: `cassie:run:${run.runId}`,
        jobKeyMode: "unsafe_dedupe",
        queueName: `cassie:run:${run.runId}`,
        maxAttempts: Number(process.env.GRAPHILE_SUPERVISOR_MAX_ATTEMPTS ?? 3),
      },
    );

    return { runId: run.runId, graphileJobId: graphileJob.id };
  }

  private async getWorkerUtils(): Promise<WorkerUtils> {
    if (!this.databaseUrl) {
      throw new MissingDatabaseConfigError();
    }

    this.workerUtils ??= makeWorkerUtils({ connectionString: this.databaseUrl }).then(async (utils) => {
      await utils.migrate();
      return utils;
    });

    return this.workerUtils;
  }
}

export async function executeExecutionJob(input: {
  jobId: string;
  store?: CassieStore;
  executionClient?: ExecutionClient;
  accountStateProvider?: AccountStateProvider;
}): Promise<ExecutionJob> {
  const store = input.store ?? new DrizzleCassieStore();
  const executionClient = input.executionClient ?? defaultExecutionClient();
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

export async function enqueueAutoApprovedTicketsForRun(input: {
  runId: string;
  store?: CassieStore;
  jobQueue?: CassieJobQueue;
}): Promise<{ enqueued: number; ticketIds: string[] }> {
  const store = input.store ?? new DrizzleCassieStore();
  const jobQueue = input.jobQueue ?? new GraphileExecutionJobQueue();
  const tickets = await store.listAutoApprovedTicketsWithoutExecutionJob(input.runId);

  const ticketIds: string[] = [];
  for (const ticket of tickets) {
    await queueExecutionJob({
      store,
      jobQueue,
      ticket,
      message: "Auto-approved trade ticket queued for execution.",
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
  if (input.ticket.approvalState !== "approved" && input.ticket.approvalState !== "not_required") {
    throw new Error("Trade ticket is not approved for execution.");
  }

  const userSettings = await input.store.getUserSettings(input.ticket.userId);
  if (!userSettings) {
    throw new Error(`No Cassie settings found for user ${input.ticket.userId}.`);
  }

  const accountState = await (input.accountStateProvider ?? new HyperliquidAccountStateProvider())
    .getAccountState(userSettings);
  const decision = evaluateRisk({
    marketSelection: {
      selectedMarket: ticketToMarketCandidate(input.ticket),
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
    markPrice: ticket.venueData?.markPrice ?? null,
    liquidityScore: 1,
    spreadBps: ticket.venueData?.spreadBps ?? 0,
    estimatedSlippageBps: ticket.venueData?.estimatedSlippageBps ?? 0,
    minOrderSizeUsd: ticket.venueData?.minOrderSizeUsd ?? 0,
    thesisFit: 1,
    reason: "Execution preflight candidate reconstructed from approved ticket.",
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

export function createExecutionTaskList(): TaskList {
  return {
    [EXECUTE_TRADE_TICKET_TASK]: async (payload) => {
      const parsed = ExecuteTradeTicketPayloadSchema.parse(payload);
      await executeExecutionJob({ jobId: parsed.jobId });
    },
    [RUN_CASSIE_SUPERVISOR_TASK]: async (payload) => {
      const parsed = RunCassieSupervisorPayloadSchema.parse(payload);
      await runCassieSupervisorForRun({ runId: parsed.runId });
      await enqueueAutoApprovedTicketsForRun({ runId: parsed.runId });
    },
  };
}

export async function runExecutionWorker() {
  if (!process.env.DATABASE_URL) {
    throw new MissingDatabaseConfigError();
  }

  const pool = createPostgresPool();
  return run({
    pgPool: pool,
    taskList: createExecutionTaskList(),
    concurrency: Number(process.env.GRAPHILE_WORKER_CONCURRENCY ?? 1),
    pollInterval: Number(process.env.GRAPHILE_WORKER_POLL_INTERVAL_MS ?? 2_000),
  });
}

function defaultExecutionClient(): ExecutionClient {
  return process.env.EXECUTION_WEBHOOK_URL
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
