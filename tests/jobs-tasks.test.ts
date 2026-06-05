import { beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_OPEN_POSITIONS_TASK } from "../packages/jobs/queue.ts";
import { createExecutionTaskList } from "../packages/jobs/tasks.ts";
import { reviewAllOpenPositions, reviewOpenPositionsForUser } from "../packages/positions/review.ts";

vi.mock("../packages/agent/agent.ts", () => ({
  runCassieSupervisorForRun: vi.fn(),
}));

vi.mock("../packages/jobs/execution-job.ts", () => ({
  enqueueTradeTicketsForRun: vi.fn(),
  executeExecutionJob: vi.fn(),
}));

vi.mock("../packages/positions/close.ts", () => ({
  executeClosePosition: vi.fn(),
}));

vi.mock("../packages/positions/review.ts", () => ({
  reviewAllOpenPositions: vi.fn(),
  reviewOpenPositionsForUser: vi.fn(),
}));

const mockedReviewAllOpenPositions = vi.mocked(reviewAllOpenPositions);
const mockedReviewOpenPositionsForUser = vi.mocked(reviewOpenPositionsForUser);

describe("execution task list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reviews all open positions with daily summary notifications enabled", async () => {
    const tasks = createExecutionTaskList();

    await tasks[REVIEW_OPEN_POSITIONS_TASK]?.({}, {} as never);

    expect(mockedReviewAllOpenPositions).toHaveBeenCalledWith();
    expect(mockedReviewOpenPositionsForUser).not.toHaveBeenCalled();
  });

  it("reviews one user's open positions with daily summary notifications enabled", async () => {
    const tasks = createExecutionTaskList();

    await tasks[REVIEW_OPEN_POSITIONS_TASK]?.({ userId: "user_1" }, {} as never);

    expect(mockedReviewOpenPositionsForUser).toHaveBeenCalledWith({ userId: "user_1" });
    expect(mockedReviewAllOpenPositions).not.toHaveBeenCalled();
  });
});
