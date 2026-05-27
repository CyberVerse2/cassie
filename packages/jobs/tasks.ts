import type { TaskList } from "graphile-worker";
import { runCassieSupervisorForRun } from "../agent/agent.ts";
import { enqueueTradeTicketsForRun, executeExecutionJob } from "./execution-job.ts";
import {
  EXECUTE_TRADE_TICKET_TASK,
  ExecuteTradeTicketPayloadSchema,
  RUN_CASSIE_SUPERVISOR_TASK,
  RunCassieSupervisorPayloadSchema,
} from "./queue.ts";

export function createExecutionTaskList(): TaskList {
  return {
    [EXECUTE_TRADE_TICKET_TASK]: async (payload) => {
      const parsed = ExecuteTradeTicketPayloadSchema.parse(payload);
      await executeExecutionJob({ jobId: parsed.jobId });
    },
    [RUN_CASSIE_SUPERVISOR_TASK]: async (payload) => {
      const parsed = RunCassieSupervisorPayloadSchema.parse(payload);
      await runCassieSupervisorForRun({ runId: parsed.runId });
      await enqueueTradeTicketsForRun({ runId: parsed.runId });
    },
  };
}
