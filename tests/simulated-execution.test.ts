import { describe, expect, it, vi } from "vitest";
import type { TradeExitPlan, TradeTicket, Position } from "../packages/core/schemas/index.ts";
import {
  SimulatedExecutionClient,
  SimulatedPositionCloseClient,
} from "../packages/execution/simulated.ts";
import { readSimulatedExecutionEnv } from "../packages/core/config.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL should rally.",
  invalidationSignals: ["Momentum fades."],
};

const hyperliquidTicket: TradeTicket = {
  ticketId: "ticket_hl",
  runId: "run_1",
  userId: "x:x_1",
  thesis: "SOL should rally.",
  venue: "hyperliquid",
  instrument: "SOL",
  side: "long",
  sizeUsd: 25,
  orderType: "marketable_limit",
  venueData: { symbol: "SOL", leverage: 3 },
  exitPlan,
};

const polymarketTicket: TradeTicket = {
  ticketId: "ticket_pm",
  runId: "run_1",
  userId: "x:x_1",
  thesis: "ETF approval odds mispriced.",
  venue: "polymarket",
  instrument: "solana-etf-approved",
  side: "buy_yes",
  sizeUsd: 25,
  orderType: "marketable_limit",
  venueData: { outcomeTokenId: "token_1", conditionId: "cond_1" },
  exitPlan,
};

describe("simulated execution", () => {
  it("fills Hyperliquid tickets at the live mid with leverage semantics", async () => {
    const client = new SimulatedExecutionClient({
      hyperliquidMid: vi.fn().mockResolvedValue(100),
    });

    const result = await client.execute(hyperliquidTicket);

    expect(result.venueOrderId).toMatch(/^sim:/);
    expect(result.filledSizeUsd).toBe(75);
    expect(result.collateralUsedUsd).toBe(25);
    expect(result.filledBaseSize).toBe(0.75);
    expect(result.averagePrice).toBe(100);
  });

  it("fills Polymarket tickets at the quoted held-side price", async () => {
    const quote = vi.fn().mockResolvedValue({ heldSidePrice: 0.5 });
    const client = new SimulatedExecutionClient({
      polymarket: { quotePolymarketMarket: quote } as never,
    });

    const result = await client.execute(polymarketTicket);

    expect(result.venueOrderId).toMatch(/^sim:/);
    expect(result.filledSizeUsd).toBe(25);
    expect(result.filledBaseSize).toBe(50);
    expect(result.averagePrice).toBe(0.5);
    expect(quote).toHaveBeenCalledWith({
      conditionId: "cond_1",
      outcomeTokenId: "token_1",
      side: "yes",
    });
  });

  it("fills spot tickets via the spot mid source, not allMids", async () => {
    const spotTicket: TradeTicket = {
      ...hyperliquidTicket,
      ticketId: "ticket_hl_spot",
      instrument: "spot",
      side: "buy",
      venueData: { symbol: "UZEC/USDC" },
    };
    const perpMid = vi.fn().mockResolvedValue(1);
    const spotMid = vi.fn().mockResolvedValue(50);
    const client = new SimulatedExecutionClient({
      hyperliquidMid: perpMid,
      hyperliquidSpotMid: spotMid,
    });

    const result = await client.execute(spotTicket);

    expect(spotMid).toHaveBeenCalledWith("UZEC/USDC");
    expect(perpMid).not.toHaveBeenCalled();
    expect(result.filledSizeUsd).toBe(25);
    expect(result.filledBaseSize).toBe(0.5);
    expect(result.averagePrice).toBe(50);
  });

  it("rejects unusable prices instead of filling at zero", async () => {
    const client = new SimulatedExecutionClient({
      hyperliquidMid: vi.fn().mockResolvedValue(Number.NaN),
    });
    await expect(client.execute(hyperliquidTicket)).rejects.toThrow(
      "Hyperliquid mid for SOL returned no usable price.",
    );
  });

  it("closes positions at the live mark price", async () => {
    const position: Position = {
      positionId: "position_1",
      userId: "x:x_1",
      ticketId: "ticket_hl",
      executionJobId: "job_1",
      venue: "hyperliquid",
      instrument: "SOL",
      side: "long",
      status: "closing",
      entrySizeUsd: 25,
      filledBaseSize: 0.75,
      filledSizeUsd: 75,
      entryPrice: 100,
      currentMarkPrice: 100,
      currentValueUsd: 75,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      exitPlan,
      openedAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      lastMarkedAt: "2026-07-01T00:00:00.000Z",
      closedAt: null,
      closeExecutionJobId: null,
      failureReason: null,
    };
    const client = new SimulatedPositionCloseClient({
      markPosition: vi.fn().mockResolvedValue({
        markPrice: 110,
        currentValueUsd: 82.5,
        markedAt: "2026-07-01T01:00:00.000Z",
      }),
    });

    const result = await client.close(position, hyperliquidTicket);

    expect(result.venueOrderId).toMatch(/^sim:/);
    expect(result.filledBaseSize).toBe(0.75);
    expect(result.filledSizeUsd).toBe(82.5);
    expect(result.averagePrice).toBe(110);
  });
});

describe("simulated execution config", () => {
  it("follows the Circle testnet flag by default", () => {
    expect(readSimulatedExecutionEnv({})).toBe(true);
    expect(readSimulatedExecutionEnv({ CIRCLE_TESTNET: "0" })).toBe(false);
  });

  it("honors the explicit override in both directions", () => {
    expect(readSimulatedExecutionEnv({ CASSIE_SIMULATED_EXECUTION: "0" })).toBe(false);
    expect(readSimulatedExecutionEnv({
      CIRCLE_TESTNET: "0",
      CASSIE_SIMULATED_EXECUTION: "1",
    })).toBe(true);
  });
});
