import { parseCronItems, run, type CronItem } from "graphile-worker";
import { config } from "../core/config.ts";
import { createPostgresPool, MissingDatabaseConfigError } from "../core/db/client.ts";
import { POLL_X_COMMAND_MENTIONS_TASK, REVIEW_OPEN_POSITIONS_TASK } from "./queue.ts";
import { createExecutionTaskList } from "./tasks.ts";

export async function runExecutionWorker() {
  if (!config.database.url) {
    throw new MissingDatabaseConfigError();
  }

  const pool = createPostgresPool();
  return run({
    pgPool: pool,
    taskList: createExecutionTaskList(),
    concurrency: config.graphileWorker.concurrency,
    pollInterval: config.graphileWorker.pollIntervalMs,
    parsedCronItems: parseCronItems(createExecutionWorkerCronItems({
      positionReviewIntervalMinutes: config.graphileWorker.positionReviewIntervalMinutes,
      xMentionPollIntervalMinutes: config.graphileWorker.xMentionPollIntervalMinutes,
    })),
  });
}

export function createExecutionWorkerCronItems(input: {
  positionReviewIntervalMinutes: number;
  xMentionPollIntervalMinutes: number;
}): CronItem[] {
  if (!validMinuteInterval(input.positionReviewIntervalMinutes)) {
    throw new Error("Position review interval must be a whole number from 1 to 59 minutes.");
  }
  if (!validMinuteInterval(input.xMentionPollIntervalMinutes)) {
    throw new Error("X mention poll interval must be a whole number from 1 to 59 minutes.");
  }

  return [
    {
      task: REVIEW_OPEN_POSITIONS_TASK,
      match: `*/${input.positionReviewIntervalMinutes} * * * *`,
      options: {
        backfillPeriod: 0,
        maxAttempts: 1,
        queueName: "position-review",
        jobKey: "cassie:position-review:all",
        jobKeyMode: "preserve_run_at",
      },
    },
    {
      task: POLL_X_COMMAND_MENTIONS_TASK,
      match: `*/${input.xMentionPollIntervalMinutes} * * * *`,
      options: {
        backfillPeriod: 0,
        maxAttempts: 1,
        queueName: "x-mentions",
        jobKey: "cassie:x-mentions:poll",
        jobKeyMode: "preserve_run_at",
      },
    },
  ];
}

function validMinuteInterval(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 59;
}
