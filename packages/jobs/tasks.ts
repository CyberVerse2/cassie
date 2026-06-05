import type { TaskList } from "graphile-worker";
import { runCassieSupervisorForRun } from "../agent/agent.ts";
import { enqueueTradeTicketsForRun, executeExecutionJob } from "./execution-job.ts";
import { executeClosePosition } from "../positions/close.ts";
import { reviewAllOpenPositions, reviewOpenPositionsForUser } from "../positions/review.ts";
import { pollXCommandMentions } from "../app/x-mention-poller.ts";
import {
  CLOSE_POSITION_TASK,
  ClosePositionPayloadSchema,
  EXECUTE_TRADE_TICKET_TASK,
  ExecuteTradeTicketPayloadSchema,
  POLL_X_COMMAND_MENTIONS_TASK,
  PollXCommandMentionsPayloadSchema,
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
        await reviewOpenPositionsForUser({ userId: parsed.userId });
      } else {
        await reviewAllOpenPositions();
      }
    },
    [CLOSE_POSITION_TASK]: async (payload) => {
      const parsed = ClosePositionPayloadSchema.parse(payload);
      await executeClosePosition({ positionId: parsed.positionId });
    },
    [POLL_X_COMMAND_MENTIONS_TASK]: async (payload) => {
      PollXCommandMentionsPayloadSchema.parse(payload);
      await pollXCommandMentions();
    },
  };
}
