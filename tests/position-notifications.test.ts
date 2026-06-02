import { describe, expect, it } from "vitest";
import type { ExecutionJob, Position, TradeExitPlan, TradeTicket } from "../packages/core/schemas/index.ts";
import {
  formatDailyPositionSummary,
  formatExecutionFailed,
  formatTicketCreated,
  formatTradeExecuted,
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
});
