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

vi.mock("../packages/withdrawals/index.ts", () => ({
  executeWithdrawal: vi.fn(),
}));

const mockedReviewAllOpenPositions = vi.mocked(reviewAllOpenPositions);
const mockedReviewOpenPositionsForUser = vi.mocked(reviewOpenPositionsForUser);

describe("execution task list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks all open positions without sending scheduled Telegram summaries", async () => {
    const tasks = createExecutionTaskList();

    await tasks[REVIEW_OPEN_POSITIONS_TASK]?.({}, {} as never);

    expect(mockedReviewAllOpenPositions).toHaveBeenCalledWith({ notify: false });
    expect(mockedReviewOpenPositionsForUser).not.toHaveBeenCalled();
  });

  it("marks one user's open positions without sending scheduled Telegram summaries", async () => {
    const tasks = createExecutionTaskList();

    await tasks[REVIEW_OPEN_POSITIONS_TASK]?.({ userId: "user_1" }, {} as never);

    expect(mockedReviewOpenPositionsForUser).toHaveBeenCalledWith({ userId: "user_1", notify: false });
    expect(mockedReviewAllOpenPositions).not.toHaveBeenCalled();
  });
});
