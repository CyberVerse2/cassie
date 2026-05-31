import { describe, expect, it } from "vitest";
import { CassieProduct } from "../packages/app/product.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { ControlRun, ExecutionJob, SourcePost, UserSettings } from "../packages/core/schemas/index.ts";
import type { CassieJobQueue } from "../packages/jobs/queue.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "post_1",
  url: "https://x.com/example/status/post_1",
  authorHandle: "example",
  authorName: "Example",
  text: "Solana ETF approval is basically inevitable now. Market is asleep.",
  createdAt: "2026-05-20T12:00:00Z",
  quotedPostText: null,
  linkedUrls: [],
  mediaDescriptions: [],
};

const settings: UserSettings = {
  userId: "user_1",
  privyUserId: null,
  privyWalletId: null,
  walletAddress: "0x0000000000000000000000000000000000000000",
  defaultTradeSizeUsd: 50,
};

class FakeCassieJobQueue implements CassieJobQueue {
  readonly supervisorRunIds: string[] = [];

  async enqueueExecution(_job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }> {
    throw new Error("execution must not be queued during intake");
  }

  async enqueueSupervisor(run: ControlRun) {
    this.supervisorRunIds.push(run.runId);
    return { runId: run.runId, graphileJobId: "graphile_supervisor_1" };
  }

  async enqueuePositionReview() {
    return { graphileJobId: "graphile_review_1" };
  }

  async enqueueClosePosition(input: { positionId: string }) {
    return { positionId: input.positionId, graphileJobId: "graphile_close_1" };
  }

  async enqueueWithdrawal(input: { withdrawalId: string }) {
    return { withdrawalId: input.withdrawalId, graphileJobId: "graphile_withdrawal_1" };
  }
}

describe("durable run persistence", () => {
  it("creates a durable run and records ordered steps", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    const started = await store.addRunStep({
      runId: run.runId,
      stepType: "opportunity",
      status: "running",
      input: { userCommand: "@Cassie get me in" },
      output: null,
      error: null,
      model: "deepseek-v4-pro",
      promptName: "cassie_opportunity_frame",
      promptVersion: "2026-05-20",
      thinkingTrace: "The model returned a concise reasoning summary.",
    });

    await store.updateRunStep({
      ...started,
      status: "succeeded",
      output: { userIntent: "trade" },
      completedAt: "2026-05-20T12:00:01.000Z",
    });

    const state = await store.load();
    expect(state.controlRuns[0]?.status).toBe("queued");
    expect(state.runSteps).toHaveLength(1);
    expect(state.runSteps[0]?.stepType).toBe("opportunity");
    expect(state.runSteps[0]?.output).toEqual({ userIntent: "trade" });
    expect(state.runSteps[0]?.thinkingTrace).toBe("The model returned a concise reasoning summary.");
  });

  it("mention intake creates a queued run without executing the supervisor synchronously", async () => {
    const store = new InMemoryCassieStore();
    const queue = new FakeCassieJobQueue();
    const product = new CassieProduct(
      store,
      null,
      undefined,
      queue,
    );

    await product.upsertSettings(settings);
    const result = await product.createMentionRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    expect(result.status).toBe("queued");
    expect(queue.supervisorRunIds).toEqual([result.runId]);
    expect((await store.load()).tradeTickets).toHaveLength(0);
  });

  it("returns a run with its recorded steps", async () => {
    const store = new InMemoryCassieStore();
    const queue = new FakeCassieJobQueue();
    const product = new CassieProduct(store, null, undefined, queue);

    await product.upsertSettings(settings);
    const result = await product.createMentionRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    const inspected = await product.getRun(result.runId);
    expect(inspected.run.runId).toBe(result.runId);
    expect(inspected.steps.map((step) => step.stepType)).toEqual(["intake"]);
  });
});
