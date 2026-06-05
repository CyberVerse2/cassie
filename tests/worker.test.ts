import { describe, expect, it } from "vitest";
import { POLL_X_COMMAND_MENTIONS_TASK, REVIEW_OPEN_POSITIONS_TASK } from "../packages/jobs/queue.ts";
import { createExecutionWorkerCronItems } from "../packages/jobs/worker.ts";

describe("execution worker cron", () => {
  it("schedules serialized open-position reviews at the configured interval", () => {
    expect(createExecutionWorkerCronItems({
      positionReviewIntervalMinutes: 15,
      xMentionPollIntervalMinutes: 3,
    })).toEqual([
      {
        task: REVIEW_OPEN_POSITIONS_TASK,
        match: "*/15 * * * *",
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
        match: "*/3 * * * *",
        options: {
          backfillPeriod: 0,
          maxAttempts: 1,
          queueName: "x-mentions",
          jobKey: "cassie:x-mentions:poll",
          jobKeyMode: "preserve_run_at",
        },
      },
    ]);
  });

  it("rejects invalid position review intervals", () => {
    expect(() => createExecutionWorkerCronItems({
      positionReviewIntervalMinutes: 0,
      xMentionPollIntervalMinutes: 1,
    })).toThrow("Position review interval");
    expect(() => createExecutionWorkerCronItems({
      positionReviewIntervalMinutes: 1.5,
      xMentionPollIntervalMinutes: 1,
    })).toThrow("Position review interval");
    expect(() => createExecutionWorkerCronItems({
      positionReviewIntervalMinutes: 60,
      xMentionPollIntervalMinutes: 1,
    })).toThrow("Position review interval");
  });

  it("rejects invalid X mention poll intervals", () => {
    expect(() => createExecutionWorkerCronItems({
      positionReviewIntervalMinutes: 1,
      xMentionPollIntervalMinutes: 0,
    })).toThrow("X mention poll interval");
  });
});
