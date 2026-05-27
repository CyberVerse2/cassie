import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type {
  ExecutionJob,
  TradeTicket,
  UserSettings,
} from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "user_1",
  walletAddress: "0x0000000000000000000000000000000000000000",
  defaultTradeSizeUsd: 50,
};

describe("InMemoryCassieStore", () => {
  it("stores user settings, mentions, control runs, and audit events", async () => {
    const store = new InMemoryCassieStore();

    await store.upsertUserSettings(settings);
    const mention = await store.addMention({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: null,
        authorHandle: "example",
        authorName: "Example",
        text: "SOL ETF is inevitable.",
        createdAt: null,
        quotedPostText: null,
        linkedUrls: [],
        mediaDescriptions: [],
      },
    });
    const run = await store.createRun({
      userId: "user_1",
      userCommand: mention.userCommand,
      sourcePost: mention.sourcePost,
    });
    await store.updateRun({
      ...run,
      status: "succeeded",
      result: { responseType: "analysis" },
      updatedAt: new Date().toISOString(),
    });

    const snapshot = await store.load();
    expect(snapshot.userSettings).toHaveLength(1);
    expect(snapshot.mentions).toHaveLength(1);
    expect(snapshot.controlRuns).toHaveLength(1);
    expect(snapshot.auditEvents.map((event) => event.eventType)).toContain("mention.received");
  });

  it("finds execution jobs and trade tickets without loading callers into full snapshots", async () => {
    const store = new InMemoryCassieStore();
    const ticket: TradeTicket = {
      ticketId: "ticket_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "SOL may rally.",
      venue: "hyperliquid",
      instrument: "SOL",
      side: "long",
      sizeUsd: 50,
      orderType: "marketable_limit",
      venueData: {},
    };
    const job: ExecutionJob = {
      jobId: "job_1",
      ticketId: "ticket_2",
      status: "queued",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      failureReason: null,
      executionResult: null,
    };

    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    expect(await store.getExecutionJob("job_1")).toEqual(job);
    expect((await store.listTradeTicketsWithoutExecutionJob("run_1")).map((entry) => entry.ticketId))
      .toEqual(["ticket_1"]);
  });

  it("stores model call usage for a control run", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie trade this",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: null,
        authorHandle: "example",
        authorName: "Example",
        text: "SOL ETF is inevitable.",
        createdAt: null,
        quotedPostText: null,
        linkedUrls: [],
        mediaDescriptions: [],
      },
    });

    await store.addModelCallUsage({
      controlRunId: run.runId,
      runStepId: null,
      purpose: "supervisor_step",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptName: "cassie_supervisor",
      promptVersion: "2026-05-20",
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: null,
      cachedTokens: null,
      totalTokens: 30,
      estimatedCostUsd: null,
      latencyMs: 123,
      status: "succeeded",
      error: null,
    });

    const snapshot = await store.load();
    expect(snapshot.modelCallUsage).toMatchObject([{ purpose: "supervisor_step", totalTokens: 30 }]);
  });
});
