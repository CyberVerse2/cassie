import { describe, expect, it } from "vitest";
import { buildDashboardPayload } from "../apps/web/app/api/_lib/dashboard-data.ts";
import { InMemoryCassieStore, type CassieStoreSnapshot } from "../packages/core/db/store.ts";
import type {
  ExecutionJob,
  Position,
  PositionReview,
  TradeExitPlan,
  TradeTicket,
  UserSettings,
} from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "user_1",
  privyUserId: "privy_1",
  privyWalletId: "wallet_1",
  walletAddress: "0x0000000000000000000000000000000000000000",
  profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
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

const ticket: TradeTicket = {
  ticketId: "ticket_1",
  runId: "run_1",
  userId: "user_1",
  thesis: "SOL may rally.",
  venue: "hyperliquid",
  instrument: "SOL-PERP",
  side: "long",
  sizeUsd: 50,
  orderType: "marketable_limit",
  venueData: { symbol: "SOL" },
  exitPlan,
};

const job: ExecutionJob = {
  jobId: "job_1",
  ticketId: "ticket_1",
  status: "succeeded",
  createdAt: "2026-05-31T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z",
  failureReason: null,
  executionResult: null,
};

describe("dashboard payload", () => {
  it("uses scoped dashboard reads instead of loading the full store snapshot", async () => {
    const store = new NoFullSnapshotDashboardStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    await store.addPosition(position({ positionId: "position_open", status: "open", closedAt: null }));

    const dashboard = await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 100,
    });

    expect(dashboard.openPositions.map((entry) => entry.positionId)).toEqual(["position_open"]);
  });

  it("loads account summary, grouped positions, latest reviews, and activity together", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const openPosition = position({ positionId: "position_open", status: "open", closedAt: null });
    const closedPosition = position({
      positionId: "position_closed",
      status: "closed",
      openedAt: "2026-05-30T00:00:00.000Z",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
    await store.addPosition(openPosition);
    await store.addPosition(closedPosition);
    await store.addPositionReview(review(openPosition.positionId));

    const dashboard = await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 100,
    });

    expect(dashboard.account).toMatchObject({
      userId: "user_1",
      walletAddress: settings.walletAddress,
      defaultTradeSizeUsd: 50,
      balance: {
        walletBalanceUsd: 100,
        spendableUsd: 100,
      },
    });
    expect(dashboard.openPositions).toHaveLength(1);
    expect(dashboard.portfolioBalance).toMatchObject({
      currentUsd: 155,
      walletBalanceUsd: 100,
      openPositionEquityUsd: 55,
      unrealizedPnlUsd: 5,
    });
    expect(dashboard.portfolioBalance.history).toHaveLength(1);
    expect(dashboard.portfolioBalance.history[0]).toMatchObject({
      valueUsd: 155,
      walletBalanceUsd: 100,
      unrealizedPnlUsd: 5,
    });
    expect(dashboard.openPositions[0]).toMatchObject({
      positionId: "position_open",
      symbol: "SOL",
      marginUsd: 50,
      leverage: null,
      notionalValueUsd: null,
      positionEquityUsd: 55,
    });
    expect(dashboard.closedPositions.map((entry) => entry.positionId)).toEqual(["position_closed"]);
    expect(dashboard.latestReviews.position_open?.summary).toBe("Take-profit threshold is active.");
    expect(dashboard.activity.map((entry) => entry.id)).toEqual([
      "position_closed:close",
      "position_open",
      "position_closed",
    ]);
    expect(dashboard.activity[0]).toMatchObject({
      kind: "trade_close",
      at: "2026-06-01T00:00:00.000Z",
      title: "SOL",
      subtitle: expect.stringContaining("+$5.00 realized P/L"),
    });
  });

  it("separates leveraged exposure from position equity", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket({
      ...ticket,
      venueData: { symbol: "SOL", leverage: 3, notionalSizeUsd: 12 },
      sizeUsd: 4,
    });
    await store.addExecutionJob(job);
    await store.addPosition({
      ...position({ positionId: "position_levered", status: "open", closedAt: null }),
      entrySizeUsd: 4,
      filledSizeUsd: 12,
      currentValueUsd: 13.2,
      unrealizedPnlUsd: 1.2,
      unrealizedPnlPct: 30,
    });

    const dashboard = await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 100,
    });

    expect(dashboard.openPositions[0]).toMatchObject({
      marginUsd: 4,
      leverage: 3,
      notionalValueUsd: 13.2,
      positionEquityUsd: 5.2,
    });
    expect(dashboard.portfolioBalance).toMatchObject({
      currentUsd: 105.2,
      walletBalanceUsd: 100,
      openPositionEquityUsd: 5.2,
      unrealizedPnlUsd: 1.2,
    });
  });

  it("keeps escrowed trade equity inside portfolio value", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    await store.addPosition(position({ positionId: "position_open", status: "open", closedAt: null }));

    const dashboard = await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 50,
    });

    expect(dashboard.portfolioBalance).toMatchObject({
      currentUsd: 105,
      walletBalanceUsd: 50,
      openPositionEquityUsd: 55,
      unrealizedPnlUsd: 5,
    });
    expect(dashboard.portfolioBalance.history[0]).toMatchObject({
      valueUsd: 105,
      walletBalanceUsd: 50,
      unrealizedPnlUsd: 5,
    });
  });

  it("persists portfolio history when wallet deposits change balance", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    await store.addPosition(position({ positionId: "position_open", status: "open", closedAt: null }));

    await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 100,
    });
    await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 150,
    });
    const dashboard = await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 150,
    });

    expect(dashboard.portfolioBalance.history.map((point) => point.valueUsd)).toEqual([155, 205]);
    expect(dashboard.portfolioBalance.history.map((point) => point.walletBalanceUsd)).toEqual([100, 150]);
  });

  it("does not show close refund transfer failures as close activity errors", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    await store.addPosition({
      ...position({
        positionId: "position_closed",
        status: "closed",
        openedAt: "2026-05-30T00:00:00.000Z",
        closedAt: "2026-06-01T00:00:00.000Z",
      }),
      failureReason: "{\"error\":\"Insufficient balance: wallet has insufficient funds for this transfer\",\"code\":\"invalid_data\"}",
    });

    const dashboard = await buildDashboardPayload(settings, store, {
      getUsdcBalanceUsd: async () => 100,
    });

    expect(dashboard.activity[0]).toMatchObject({
      id: "position_closed:close",
      kind: "trade_close",
      error: null,
    });
  });
});

class NoFullSnapshotDashboardStore extends InMemoryCassieStore {
  override async load(): Promise<CassieStoreSnapshot> {
    throw new Error("Dashboard payload must not load the full store snapshot.");
  }
}

function position(input: {
  positionId: string;
  status: Position["status"];
  openedAt?: string;
  closedAt: string | null;
}): Position {
  return {
    positionId: input.positionId,
    userId: "user_1",
    ticketId: "ticket_1",
    executionJobId: "job_1",
    venue: "hyperliquid",
    instrument: "SOL-PERP",
    side: "long",
    status: input.status,
    entrySizeUsd: 50,
    filledBaseSize: 0.5,
    filledSizeUsd: 50,
    entryPrice: 100,
    currentMarkPrice: 110,
    currentValueUsd: 55,
    unrealizedPnlUsd: 5,
    unrealizedPnlPct: 10,
    exitPlan,
    openedAt: input.openedAt ?? "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    lastMarkedAt: "2026-05-31T00:00:00.000Z",
    closedAt: input.closedAt,
    closeExecutionJobId: null,
    failureReason: null,
  };
}

function review(positionId: string): PositionReview {
  return {
    reviewId: "review_1",
    positionId,
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
}
