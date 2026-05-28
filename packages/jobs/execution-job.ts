import { config } from "../core/config.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { ExecutionJob, TradeTicket } from "../core/schemas/index.ts";
import {
  VenueExecutionClient,
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
  let releaseReservationOnFailure = false;

  try {
    await store.reserveTradeFunds(ticket, job);
    releaseReservationOnFailure = true;
    const executionResult = await executionClient.execute(ticket);
    releaseReservationOnFailure = false;
    await store.settleTradeReservation({ ticket, job, executionResult });
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
    if (releaseReservationOnFailure) {
      await store.releaseTradeReservation({
        ticket,
        job,
        reason: error instanceof Error ? error.message : String(error),
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
