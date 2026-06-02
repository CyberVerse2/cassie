import { describe, expect, it, vi } from "vitest";
import { markUserFacingHyperliquidPositions } from "../packages/positions/user-facing.ts";
import type { Position, TradeExitPlan, TradeTicket } from "../packages/core/schemas/index.ts";
import { HyperliquidPositionMarkProvider } from "../packages/positions/marks.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL momentum.",
  invalidationSignals: ["SOL momentum broke."],
};

const hyperliquidTicket: TradeTicket = {
  ticketId: "ticket_hl",
  runId: "run_1",
  userId: "user_1",
  thesis: "SOL momentum.",
  venue: "hyperliquid",
  instrument: "perp",
  side: "long",
  sizeUsd: 4,
  orderType: "marketable_limit",
  venueData: { symbol: "SOL" },
  exitPlan,
};

const hyperliquidPosition: Position = {
  positionId: "position_hl",
  userId: "user_1",
  ticketId: hyperliquidTicket.ticketId,
  executionJobId: "job_1",
  venue: "hyperliquid",
  instrument: "perp",
  side: "long",
  status: "open",
  entrySizeUsd: 4,
  filledSizeUsd: 12,
  entryPrice: 100,
  currentMarkPrice: 100,
  currentValueUsd: 12,
  unrealizedPnlUsd: 0,
  unrealizedPnlPct: 0,
  exitPlan,
  openedAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  lastMarkedAt: "2026-06-01T00:00:00.000Z",
  closedAt: null,
  closeExecutionJobId: null,
  failureReason: null,
};

describe("user-facing positions", () => {
  it("explicitly live-marks open Hyperliquid positions", async () => {
    const markProvider = {
      markPosition: vi.fn().mockResolvedValue({
        markPrice: 110,
        currentValueUsd: 13.2,
        markedAt: "2026-06-02T00:00:00.000Z",
      }),
    };

    const [position] = await markUserFacingHyperliquidPositions(
      [hyperliquidPosition],
      new Map([[hyperliquidTicket.ticketId, hyperliquidTicket]]),
      markProvider,
    );

    expect(markProvider.markPosition).toHaveBeenCalledWith({
      position: hyperliquidPosition,
      ticket: hyperliquidTicket,
    });
    expect(position).toMatchObject({
      currentMarkPrice: 110,
      currentValueUsd: 13.2,
      unrealizedPnlUsd: 1.2,
      unrealizedPnlPct: 30,
      lastMarkedAt: "2026-06-02T00:00:00.000Z",
    });
  });

  it("does not live-mark non-open or non-Hyperliquid positions", async () => {
    const markProvider = { markPosition: vi.fn() };
    const closedHyperliquid = { ...hyperliquidPosition, status: "closed" as const };
    const openPolymarket = { ...hyperliquidPosition, positionId: "position_poly", venue: "polymarket" };

    await expect(markUserFacingHyperliquidPositions(
      [closedHyperliquid, openPolymarket],
      new Map([[hyperliquidTicket.ticketId, hyperliquidTicket]]),
      markProvider,
    )).resolves.toEqual([closedHyperliquid, openPolymarket]);
    expect(markProvider.markPosition).not.toHaveBeenCalled();
  });

  it("shares one Hyperliquid allMids request across positions in a refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ SOL: "110" }),
      text: async () => JSON.stringify({ SOL: "110" }),
    });
    const provider = new HyperliquidPositionMarkProvider("https://hyperliquid.test/info");
    vi.stubGlobal("fetch", fetchMock);

    const positions = await Promise.all([
      provider.markPosition({ position: hyperliquidPosition, ticket: hyperliquidTicket }),
      provider.markPosition({
        position: { ...hyperliquidPosition, positionId: "position_hl_2" },
        ticket: hyperliquidTicket,
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      markPrice: 110,
      currentValueUsd: 13.2,
    });
    vi.unstubAllGlobals();
  });
});
