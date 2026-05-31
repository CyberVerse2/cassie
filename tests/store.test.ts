import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type {
  ExecutionJob,
  Position,
  PositionReview,
  TradeExitPlan,
  TradeTicket,
  UserSettings,
  Withdrawal,
} from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "user_1",
  privyUserId: null,
  privyWalletId: null,
  walletAddress: "0x0000000000000000000000000000000000000000",
  defaultTradeSizeUsd: 50,
};
const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL may rally.",
  invalidationSignals: ["SOL ETF thesis is invalidated."],
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
      exitPlan,
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

  it("syncs Privy identity into user settings", async () => {
    const store = new InMemoryCassieStore();

    const first = await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
    });
    const updated = await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_2",
      walletAddress: "0x2222222222222222222222222222222222222222",
      defaultTradeSizeUsd: 25,
    });

    expect(first.userId).toBe("did:privy:user_1");
    expect(updated).toMatchObject({
      userId: "did:privy:user_1",
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_2",
      walletAddress: "0x2222222222222222222222222222222222222222",
      defaultTradeSizeUsd: 25,
    });
    expect((await store.load()).userSettings).toHaveLength(1);
  });

  it("tracks open signer-provisioned wallet spend reservations against live wallet balance", async () => {
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
      exitPlan,
    };
    const job: ExecutionJob = {
      jobId: "job_1",
      ticketId: "ticket_1",
      status: "running",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      failureReason: null,
      executionResult: null,
    };

    await store.reserveWalletSpend({ ticket, job, walletBalanceUsd: 100 });
    await store.reserveWalletSpend({ ticket, job, walletBalanceUsd: 100 });
    expect((await store.load()).walletSpendLedgerEntries).toHaveLength(1);
    expect(await store.getWalletFundingBalance("user_1", 100)).toMatchObject({
      userId: "user_1",
      walletBalanceUsd: 100,
      reservedUsd: 50,
      spendableUsd: 50,
    });

    await expect(store.reserveWalletSpend({
      ticket: { ...ticket, ticketId: "ticket_2", sizeUsd: 75 },
      job: { ...job, jobId: "job_2", ticketId: "ticket_2" },
      walletBalanceUsd: 100,
    })).rejects.toThrow("Insufficient user wallet balance.");

    await store.releaseWalletSpend({ ticket, job, reason: "venue unavailable", walletBalanceUsd: 100 });
    expect(await store.getWalletFundingBalance("user_1", 100)).toMatchObject({
      walletBalanceUsd: 100,
      reservedUsd: 0,
      spendableUsd: 100,
    });
  });

  it("settles partial fills in cents and releases the unfilled reservation", async () => {
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
      exitPlan,
    };
    const job: ExecutionJob = {
      jobId: "job_1",
      ticketId: "ticket_1",
      status: "running",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      failureReason: null,
      executionResult: null,
    };

    await store.reserveWalletSpend({ ticket, job, walletBalanceUsd: 100 });
    await store.settleWalletSpend({
      ticket,
      job,
      walletBalanceUsd: 100,
      executionResult: {
        venueOrderId: "order_1",
        filledSizeUsd: 33.33,
        averagePrice: 0.5,
      },
    });

    expect((await store.load()).walletSpendLedgerEntries.map((entry) => ({
      type: entry.type,
      amountUsd: entry.amountUsd,
    }))).toEqual([
      { type: "trade_reserve", amountUsd: 50 },
      { type: "trade_spend", amountUsd: 33.33 },
      { type: "trade_release", amountUsd: 16.67 },
    ]);
    expect(await store.getWalletFundingBalance("user_1", 100)).toMatchObject({
      walletBalanceUsd: 100,
      reservedUsd: 0,
      spendableUsd: 100,
    });
  });

  it("stores positions, reviews, and withdrawals as durable account state", async () => {
    const store = new InMemoryCassieStore();
    const position: Position = {
      positionId: "position_1",
      userId: "user_1",
      ticketId: "ticket_1",
      executionJobId: "job_1",
      venue: "hyperliquid",
      instrument: "SOL-PERP",
      side: "long",
      status: "open",
      entrySizeUsd: 50,
      filledSizeUsd: 50,
      entryPrice: 100,
      currentMarkPrice: 110,
      currentValueUsd: 55,
      unrealizedPnlUsd: 5,
      unrealizedPnlPct: 10,
      exitPlan,
      openedAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      lastMarkedAt: "2026-05-31T00:00:00.000Z",
      closedAt: null,
      closeExecutionJobId: null,
      failureReason: null,
    };
    const review: PositionReview = {
      reviewId: "review_1",
      positionId: "position_1",
      userId: "user_1",
      reviewedAt: "2026-06-01T00:00:00.000Z",
      status: "succeeded",
      markPrice: 110,
      currentValueUsd: 55,
      unrealizedPnlUsd: 5,
      unrealizedPnlPct: 10,
      exitSignal: "take_profit",
      summary: "Take-profit threshold is active.",
      failureReason: null,
    };
    const withdrawal: Withdrawal = {
      withdrawalId: "withdrawal_1",
      userId: "user_1",
      amountUsd: 10,
      destinationAddress: "0x1111111111111111111111111111111111111111",
      status: "queued",
      transferId: null,
      failureReason: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      completedAt: null,
    };

    await store.addPosition(position);
    await store.addPositionReview(review);
    await store.addWithdrawal(withdrawal);

    expect(await store.getPosition("position_1")).toEqual(position);
    expect(await store.getPositionByExecutionJob("job_1")).toEqual(position);
    expect(await store.listOpenPositions("user_1")).toEqual([position]);
    expect(await store.listUserPositions("user_1")).toEqual([position]);
    expect(await store.getLatestPositionReview("position_1")).toEqual(review);
    expect(await store.listPositionReviews("position_1")).toEqual([review]);
    expect(await store.getWithdrawal("withdrawal_1")).toEqual(withdrawal);
    expect(await store.listUserWithdrawals("user_1")).toEqual([withdrawal]);

    const closed = {
      ...position,
      status: "closed" as const,
      updatedAt: "2026-06-02T00:00:00.000Z",
      closedAt: "2026-06-02T00:00:00.000Z",
    };
    const failedWithdrawal = {
      ...withdrawal,
      status: "failed" as const,
      failureReason: "transfer failed",
      updatedAt: "2026-06-02T00:00:00.000Z",
    };
    await store.updatePosition(closed);
    await store.updateWithdrawal(failedWithdrawal);

    expect(await store.listOpenPositions("user_1")).toEqual([]);
    expect(await store.getPosition("position_1")).toMatchObject({ status: "closed" });
    expect(await store.getWithdrawal("withdrawal_1")).toMatchObject({
      status: "failed",
      failureReason: "transfer failed",
    });
  });
});
