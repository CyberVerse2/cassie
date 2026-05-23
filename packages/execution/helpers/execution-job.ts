import { randomUUID } from "node:crypto";
import type { ExecutionJob } from "../../core/schemas/index.ts";

export function createQueuedExecutionJob(ticketId: string): ExecutionJob {
  const now = new Date().toISOString();

  return {
    jobId: randomUUID(),
    ticketId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    failureReason: null,
    executionResult: null,
  };
}

export function markExecutionRunning(job: ExecutionJob): ExecutionJob {
  return {
    ...job,
    status: "running",
    updatedAt: new Date().toISOString(),
  };
}

export function markExecutionSucceeded(
  job: ExecutionJob,
  executionResult: ExecutionJob["executionResult"],
): ExecutionJob {
  return {
    ...job,
    status: "succeeded",
    updatedAt: new Date().toISOString(),
    executionResult,
  };
}

export function markExecutionFailed(job: ExecutionJob, failureReason: string): ExecutionJob {
  return {
    ...job,
    status: "failed",
    updatedAt: new Date().toISOString(),
    failureReason,
  };
}
