import { parseCronItems, run, type CronItem } from "graphile-worker";
import { config } from "../core/config.ts";
import { createPostgresPool, MissingDatabaseConfigError } from "../core/db/client.ts";
import { REVIEW_OPEN_POSITIONS_TASK } from "./queue.ts";
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
    parsedCronItems: parseCronItems(createExecutionWorkerCronItems(config.graphileWorker.positionReviewIntervalMinutes)),
  });
}

export function createExecutionWorkerCronItems(positionReviewIntervalMinutes: number): CronItem[] {
  if (!Number.isInteger(positionReviewIntervalMinutes) || positionReviewIntervalMinutes < 1 || positionReviewIntervalMinutes > 59) {
    throw new Error("Position review interval must be a whole number from 1 to 59 minutes.");
  }

  return [
    {
      task: REVIEW_OPEN_POSITIONS_TASK,
      match: `*/${positionReviewIntervalMinutes} * * * *`,
      options: {
        backfillPeriod: 0,
        maxAttempts: 1,
        queueName: "position-review",
        jobKey: "cassie:position-review:all",
        jobKeyMode: "preserve_run_at",
      },
    },
  ];
}
