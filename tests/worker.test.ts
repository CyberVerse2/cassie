import { describe, expect, it } from "vitest";
import { REVIEW_OPEN_POSITIONS_TASK } from "../packages/jobs/queue.ts";
import { createExecutionWorkerCronItems } from "../packages/jobs/worker.ts";

describe("execution worker cron", () => {
  it("schedules serialized open-position reviews at the configured interval", () => {
    expect(createExecutionWorkerCronItems(15)).toEqual([
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
    ]);
  });

  it("rejects invalid position review intervals", () => {
    expect(() => createExecutionWorkerCronItems(0)).toThrow("Position review interval");
    expect(() => createExecutionWorkerCronItems(1.5)).toThrow("Position review interval");
    expect(() => createExecutionWorkerCronItems(60)).toThrow("Position review interval");
  });
});
