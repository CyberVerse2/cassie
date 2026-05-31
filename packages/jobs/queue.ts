import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { z } from "zod";
import { config } from "../core/config.ts";
import { MissingDatabaseConfigError } from "../core/db/client.ts";
import type { ControlRun, ExecutionJob } from "../core/schemas/index.ts";

export const EXECUTE_TRADE_TICKET_TASK = "execute_trade_ticket";
export const RUN_CASSIE_SUPERVISOR_TASK = "run_cassie_supervisor";
export const REVIEW_OPEN_POSITIONS_TASK = "review_open_positions";
export const CLOSE_POSITION_TASK = "close_position";
export const EXECUTE_WITHDRAWAL_TASK = "execute_withdrawal";

export const ExecuteTradeTicketPayloadSchema = z.object({
  jobId: z.string(),
});

export const RunCassieSupervisorPayloadSchema = z.object({
  runId: z.string(),
});

export const ReviewOpenPositionsPayloadSchema = z.object({
  userId: z.string().optional(),
});

export const ClosePositionPayloadSchema = z.object({
  positionId: z.string(),
});

export const ExecuteWithdrawalPayloadSchema = z.object({
  withdrawalId: z.string(),
});

export interface CassieJobQueue {
  enqueueExecution(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }>;
  enqueueSupervisor(run: ControlRun): Promise<{ runId: string; graphileJobId: string | null }>;
  enqueuePositionReview(input?: { userId?: string }): Promise<{ graphileJobId: string | null }>;
  enqueueClosePosition(input: { positionId: string }): Promise<{ positionId: string; graphileJobId: string | null }>;
  enqueueWithdrawal(input: { withdrawalId: string }): Promise<{ withdrawalId: string; graphileJobId: string | null }>;
}

export class GraphileExecutionJobQueue implements CassieJobQueue {
  private workerUtils: Promise<WorkerUtils> | null = null;

  constructor(private readonly databaseUrl = config.database.url) {}

  async enqueueExecution(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }> {
    const workerUtils = await this.getWorkerUtils();
    const graphileJob = await workerUtils.addJob(
      EXECUTE_TRADE_TICKET_TASK,
      { jobId: job.jobId },
      {
        jobKey: `cassie:execution:${job.jobId}`,
        jobKeyMode: "unsafe_dedupe",
        queueName: `cassie:ticket:${job.ticketId}`,
        maxAttempts: config.graphileWorker.executionMaxAttempts,
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
        maxAttempts: config.graphileWorker.supervisorMaxAttempts,
      },
    );

    return { runId: run.runId, graphileJobId: graphileJob.id };
  }

  async enqueuePositionReview(input: { userId?: string } = {}): Promise<{ graphileJobId: string | null }> {
    const workerUtils = await this.getWorkerUtils();
    const graphileJob = await workerUtils.addJob(
      REVIEW_OPEN_POSITIONS_TASK,
      input,
      {
        jobKey: input.userId ? `cassie:position-review:${input.userId}` : "cassie:position-review:all",
        jobKeyMode: "unsafe_dedupe",
        queueName: "cassie:position-review",
        maxAttempts: config.graphileWorker.executionMaxAttempts,
      },
    );
    return { graphileJobId: graphileJob.id };
  }

  async enqueueClosePosition(input: { positionId: string }): Promise<{ positionId: string; graphileJobId: string | null }> {
    const workerUtils = await this.getWorkerUtils();
    const graphileJob = await workerUtils.addJob(
      CLOSE_POSITION_TASK,
      input,
      {
        jobKey: `cassie:position-close:${input.positionId}`,
        jobKeyMode: "unsafe_dedupe",
        queueName: `cassie:position:${input.positionId}`,
        maxAttempts: config.graphileWorker.executionMaxAttempts,
      },
    );
    return { positionId: input.positionId, graphileJobId: graphileJob.id };
  }

  async enqueueWithdrawal(input: { withdrawalId: string }): Promise<{ withdrawalId: string; graphileJobId: string | null }> {
    const workerUtils = await this.getWorkerUtils();
    const graphileJob = await workerUtils.addJob(
      EXECUTE_WITHDRAWAL_TASK,
      input,
      {
        jobKey: `cassie:withdrawal:${input.withdrawalId}`,
        jobKeyMode: "unsafe_dedupe",
        queueName: `cassie:withdrawal:${input.withdrawalId}`,
        maxAttempts: config.graphileWorker.executionMaxAttempts,
      },
    );
    return { withdrawalId: input.withdrawalId, graphileJobId: graphileJob.id };
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
