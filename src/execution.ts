import { randomUUID } from "node:crypto";
import type { ExecutionJob, TradeTicket } from "./schemas.js";
import { MissingConnectorConfigError, readJsonResponse } from "./connectors/errors.js";

export interface ExecutionClient {
  execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]>;
}

export class WebhookExecutionClient implements ExecutionClient {
  constructor(private readonly endpoint = process.env.EXECUTION_WEBHOOK_URL) {}

  async execute(ticket: TradeTicket): Promise<ExecutionJob["executionResult"]> {
    if (!this.endpoint) {
      throw new MissingConnectorConfigError("Execution worker", "EXECUTION_WEBHOOK_URL");
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });

    const payload = await readJsonResponse<{
      venueOrderId?: string | null;
      filledSizeUsd?: number;
      averagePrice?: number | null;
      raw?: unknown;
    }>("Execution worker", response);

    return {
      venueOrderId: payload.venueOrderId ?? null,
      filledSizeUsd: payload.filledSizeUsd ?? 0,
      averagePrice: payload.averagePrice ?? null,
      raw: payload.raw ?? payload,
    };
  }
}

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
