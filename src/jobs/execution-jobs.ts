import { makeWorkerUtils, run, type TaskList, type WorkerUtils } from "graphile-worker";
import { z } from "zod";
import { createPostgresPool, MissingDatabaseConfigError } from "../db/client.js";
import { DrizzleCassieStore } from "../db/store.js";
import {
  VenueExecutionClient,
  WebhookExecutionClient,
  markExecutionFailed,
  markExecutionRunning,
  markExecutionSucceeded,
  type ExecutionClient,
} from "../execution.js";
import type { ExecutionJob } from "../schemas.js";
import type { CassieStore } from "../store.js";

export const EXECUTE_TRADE_TICKET_TASK = "execute_trade_ticket";

const ExecuteTradeTicketPayloadSchema = z.object({
  jobId: z.string(),
});

export interface ExecutionJobQueue {
  enqueue(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }>;
}

export class GraphileExecutionJobQueue implements ExecutionJobQueue {
  private workerUtils: Promise<WorkerUtils> | null = null;

  constructor(private readonly databaseUrl = process.env.DATABASE_URL) {}

  async enqueue(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }> {
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
}): Promise<ExecutionJob> {
  const store = input.store ?? new DrizzleCassieStore();
  const executionClient = input.executionClient ?? defaultExecutionClient();
  const snapshot = await store.load();
  const jobToRun = snapshot.executionJobs.find((job) => job.jobId === input.jobId);

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

export function createExecutionTaskList(): TaskList {
  return {
    [EXECUTE_TRADE_TICKET_TASK]: async (payload) => {
      const parsed = ExecuteTradeTicketPayloadSchema.parse(payload);
      await executeExecutionJob({ jobId: parsed.jobId });
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
