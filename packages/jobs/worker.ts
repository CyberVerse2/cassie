import { parseCronItems, run, type CronItem } from "graphile-worker";
import { config } from "../core/config.ts";
import { createPostgresPool, MissingDatabaseConfigError } from "../core/db/client.ts";
import { POLL_DEPOSITS_TASK, POLL_X_COMMAND_MENTIONS_TASK, REVIEW_OPEN_POSITIONS_TASK } from "./queue.ts";
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
      depositPollIntervalMinutes: config.graphileWorker.depositPollIntervalMinutes,
      depositPollEnabled: Boolean(config.circle.apiKey),
    })),
  });
}

export function createExecutionWorkerCronItems(input: {
  positionReviewIntervalMinutes: number;
  xMentionPollIntervalMinutes: number;
  depositPollIntervalMinutes?: number;
  depositPollEnabled?: boolean;
}): CronItem[] {
  if (!validMinuteInterval(input.positionReviewIntervalMinutes)) {
    throw new Error("Position review interval must be a whole number from 1 to 59 minutes.");
  }
  if (!validMinuteInterval(input.xMentionPollIntervalMinutes)) {
    throw new Error("X mention poll interval must be a whole number from 1 to 59 minutes.");
  }
  const depositPollIntervalMinutes = input.depositPollIntervalMinutes ?? 1;
  if (input.depositPollEnabled && !validMinuteInterval(depositPollIntervalMinutes)) {
    throw new Error("Deposit poll interval must be a whole number from 1 to 59 minutes.");
  }

  const depositItems: CronItem[] = input.depositPollEnabled
    ? [{
      task: POLL_DEPOSITS_TASK,
      match: `*/${depositPollIntervalMinutes} * * * *`,
      options: {
        backfillPeriod: 0,
        maxAttempts: 1,
        queueName: "deposits",
        jobKey: "cassie:deposits:poll",
        jobKeyMode: "preserve_run_at",
      },
    }]
    : [];

  return [
    ...depositItems,
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
