import type { TaskList } from "graphile-worker";
import { runCassieSupervisorForRun } from "../agent/agent.ts";
import { enqueueTradeTicketsForRun, executeExecutionJob } from "./execution-job.ts";
import { executeClosePosition } from "../positions/close.ts";
import { reviewAllOpenPositions, reviewOpenPositionsForUser } from "../positions/review.ts";
import {
  CLOSE_POSITION_TASK,
  ClosePositionPayloadSchema,
  EXECUTE_TRADE_TICKET_TASK,
  ExecuteTradeTicketPayloadSchema,
  REVIEW_OPEN_POSITIONS_TASK,
  ReviewOpenPositionsPayloadSchema,
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
    [REVIEW_OPEN_POSITIONS_TASK]: async (payload) => {
      const parsed = ReviewOpenPositionsPayloadSchema.parse(payload);
      if (parsed.userId) {
        await reviewOpenPositionsForUser({ userId: parsed.userId, notify: false });
      } else {
        await reviewAllOpenPositions({ notify: false });
      }
    },
    [CLOSE_POSITION_TASK]: async (payload) => {
      const parsed = ClosePositionPayloadSchema.parse(payload);
      await executeClosePosition({ positionId: parsed.positionId });
    },
  };
}
