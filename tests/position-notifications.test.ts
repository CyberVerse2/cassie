import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { ExecutionJob, Position, TradeExitPlan, TradeTicket, UserSettings } from "../packages/core/schemas/index.ts";
import type { TelegramGateway } from "../packages/notifications/telegram.ts";
import {
  formatDailyPositionSummary,
  formatExecutionFailed,
  formatTicketCreated,
  formatTradeExecuted,
  sendDailyPositionSummaries,
} from "../packages/notifications/positions.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL should rally.",
  invalidationSignals: ["ETF thesis fails."],
};

const ticket: TradeTicket = {
  ticketId: "ticket_1",
  runId: "run_1",
  userId: "user_1",
  thesis: exitPlan.thesis,
  venue: "hyperliquid",
  instrument: "SOL",
  side: "long",
  sizeUsd: 100,
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
  executionResult: {
    venueOrderId: "order_1",
    filledBaseSize: 1,
    filledSizeUsd: 100,
    averagePrice: 100,
  },
};

const position: Position = {
  positionId: "position_1",
  userId: "user_1",
  ticketId: "ticket_1",
  executionJobId: "job_1",
  venue: "hyperliquid",
  instrument: "SOL",
  side: "long",
  status: "open",
  entrySizeUsd: 100,
  filledBaseSize: 1,
  filledSizeUsd: 100,
  entryPrice: 100,
  currentMarkPrice: 112,
  currentValueUsd: 112,
  unrealizedPnlUsd: 12,
  unrealizedPnlPct: 12,
  exitPlan,
  openedAt: "2026-05-31T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z",
  lastMarkedAt: "2026-05-31T00:00:00.000Z",
  closedAt: null,
  closeExecutionJobId: null,
  failureReason: null,
};

describe("position notification formatting", () => {
  it("formats ticket, execution, failure, and daily position messages", () => {
    expect(formatTicketCreated(ticket)).toContain("Ticket created: SOL long");
    expect(formatTradeExecuted({ ticket, job, position })).toContain("Position opened");
    expect(formatExecutionFailed({ ticket, job: { ...job, failureReason: "venue down" } })).toContain("venue down");
    expect(formatDailyPositionSummary({
      positions: [{
        position,
        review: {
          reviewId: "review_1",
          positionId: "position_1",
          userId: "user_1",
          reviewedAt: "2026-05-31T00:00:00.000Z",
          status: "succeeded",
          markPrice: 112,
          currentValueUsd: 112,
          unrealizedPnlUsd: 12,
          unrealizedPnlPct: 12,
          exitSignal: "take_profit",
          summary: "Take profit.",
          failureReason: null,
        },
      }],
    })).toContain("signal=take_profit");
  });

  it("sends each user's position summary once per UTC day", async () => {
    const store = new InMemoryCassieStore();
    const gateway = new FakeTelegramGateway();
    await store.upsertUserSettings(userSettings);
    await store.addPosition(position);

    await expect(sendDailyPositionSummaries({
      store,
      gateway,
      now: new Date("2026-06-05T10:00:00.000Z"),
    })).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });
    await expect(sendDailyPositionSummaries({
      store,
      gateway,
      now: new Date("2026-06-05T23:59:00.000Z"),
    })).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 });
    await expect(sendDailyPositionSummaries({
      store,
      gateway,
      now: new Date("2026-06-06T00:00:00.000Z"),
    })).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });

    expect(gateway.messages).toHaveLength(2);
  });

  it("does not mark a daily summary sent when Telegram delivery fails", async () => {
    const store = new InMemoryCassieStore();
    const failingGateway = new FailingTelegramGateway();
    const gateway = new FakeTelegramGateway();
    await store.upsertUserSettings(userSettings);
    await store.addPosition(position);

    await expect(sendDailyPositionSummaries({
      store,
      gateway: failingGateway,
      now: new Date("2026-06-05T10:00:00.000Z"),
    })).resolves.toEqual({ sent: 0, skipped: 0, failed: 1 });
    await expect(sendDailyPositionSummaries({
      store,
      gateway,
      now: new Date("2026-06-05T10:01:00.000Z"),
    })).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });

    expect(gateway.messages).toHaveLength(1);
  });
});

const userSettings: UserSettings = {
  userId: "user_1",
  privyUserId: null,
  privyWalletId: null,
  walletAddress: null,
  profile: {
    name: "User One",
    handle: "user1",
    avatarUrl: null,
  },
  defaultTradeSizeUsd: 10,
  telegram: {
    chatId: "chat_1",
    username: "user1",
    firstName: "User",
    lastName: "One",
    connectedAt: "2026-05-31T00:00:00.000Z",
    lastMessageAt: "2026-05-31T00:00:00.000Z",
  },
};

class FakeTelegramGateway implements TelegramGateway {
  messages: Array<{ chatId: string; text: string; disableNotification?: boolean }> = [];

  async sendMessage(input: {
    chatId: string;
    text: string;
    disableNotification?: boolean;
  }): Promise<void> {
    this.messages.push(input);
  }
}

class FailingTelegramGateway implements TelegramGateway {
  async sendMessage(): Promise<void> {
    throw new Error("telegram down");
  }
}
