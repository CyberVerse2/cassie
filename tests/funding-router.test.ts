import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { TradeExitPlan, TradeTicket, UserSettings } from "../packages/core/schemas/index.ts";
import { FundingRouter, venueChainForTicket, type TreasuryFundingGateway } from "../packages/execution/funding-router.ts";
import type { ExecutionClient } from "../packages/execution/index.ts";
import { executeExecutionJob } from "../packages/jobs/execution-job.ts";
import { createQueuedExecutionJob } from "../packages/jobs/state.ts";
import { executeClosePosition } from "../packages/positions/close.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "Solana ETF approval odds are mispriced.",
  invalidationSignals: ["Solana ETF approval odds are no longer mispriced."],
};

const ticket: TradeTicket = {
  ticketId: "ticket_1",
  runId: "run_1",
  userId: "x:x_1",
  thesis: "Solana ETF approval odds are mispriced.",
  venue: "polymarket",
  instrument: "solana-etf-approved",
  side: "buy_yes",
  sizeUsd: 25,
  orderType: "marketable_limit",
  venueData: { outcomeTokenId: "123" },
  exitPlan,
};

// Circle-wallet user: X login, no Privy wallet.
const settings: UserSettings = {
  userId: "x:x_1",
  privyUserId: null,
  privyWalletId: null,
  walletAddress: null,
  profile: { name: "Cassie", handle: "cassie", avatarUrl: null },
  x: { userId: "x_1", username: "cassie" },
  defaultTradeSizeUsd: 25,
};

const DEPOSIT_EVM_ADDRESS = "0xAAaA111111111111111111111111111111111111";
const TREASURY_ADDRESS = "0x2222222222222222222222222222222222222222";

function fakeTreasury(input: { balanceUsd: number }): TreasuryFundingGateway {
  return {
    getTreasuryWalletId: vi.fn().mockReturnValue("treasury_wallet"),
    getUsdcBalanceOnChain: vi.fn().mockResolvedValue(input.balanceUsd),
  };
}

function mockCircleWalletGateway(input: { balanceUsd: number }) {
  return {
    getUsdcBalanceUsd: vi.fn().mockResolvedValue(input.balanceUsd),
    getTreasuryWalletAddress: vi.fn().mockReturnValue(TREASURY_ADDRESS),
    transferUserUsdcToTreasury: vi.fn().mockResolvedValue({
      transferId: "circle_prefund_1",
      referenceId: "trade_prefund:job",
      status: "succeeded",
      sourceWalletId: "circle_wallet_1",
      destinationAddress: TREASURY_ADDRESS,
      amountUsd: 25,
      asset: "usdc",
      chain: "arc",
      createdAt: "2026-07-01T00:00:00.000Z",
      raw: {},
    }),
    refundUserUsdcFromTreasury: vi.fn().mockResolvedValue({
      transferId: "circle_refund_1",
      referenceId: "trade_refund:job",
      status: "succeeded",
      sourceWalletId: "treasury_wallet",
      destinationAddress: DEPOSIT_EVM_ADDRESS,
      amountUsd: 25,
      asset: "usdc",
      chain: "arc",
      createdAt: "2026-07-01T00:00:00.000Z",
      raw: {},
    }),
  };
}

async function circleUserStore(depositUsd = 100) {
  const store = new InMemoryCassieStore();
  await store.upsertUserSettings(settings);
  await store.addUserDepositAddress({
    userId: settings.userId,
    walletSetId: "wallet_set_1",
    circleWalletId: "circle_wallet_1",
    evmAddress: DEPOSIT_EVM_ADDRESS,
    createdAt: "2026-07-01T00:00:00.000Z",
  });
  await store.recordDepositCredit({
    userId: settings.userId,
    amountUsd: depositUsd,
    chain: "arc",
    txHash: "0xdeposit",
    circleTransferId: "deposit_1",
  });
  return store;
}

describe("FundingRouter", () => {
  it("maps venues to their settlement chains", () => {
    expect(venueChainForTicket(ticket)).toBe("polygon");
    expect(venueChainForTicket({ ...ticket, venue: "hyperliquid" })).toBe("arbitrum");
  });

  it("verifies venue-chain treasury USDC and records the allocation", async () => {
    const store = await circleUserStore();
    const treasury = fakeTreasury({ balanceUsd: 500 });
    const router = new FundingRouter(treasury);
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const venue = await router.ensureVenueUsdc({ store, ticket, job });

    expect(venue).toEqual({ venueChain: "polygon" });
    expect(treasury.getUsdcBalanceOnChain).toHaveBeenCalledWith({
      walletId: "treasury_wallet",
      chain: "polygon",
    });
    const state = await store.load();
    const mints = state.walletSpendLedgerEntries.filter((entry) => entry.type === "gateway_mint");
    expect(mints).toHaveLength(1);
    expect(mints[0]).toMatchObject({ chain: "polygon", amountUsd: 25 });
  });

  it("throws before recording anything when the treasury lacks venue-chain USDC", async () => {
    const store = await circleUserStore();
    const router = new FundingRouter(fakeTreasury({ balanceUsd: 10 }));
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    await expect(
      router.ensureVenueUsdc({ store, ticket, job }),
    ).rejects.toThrow(/Treasury holds \$10\.00 USDC on polygon/);
    const state = await store.load();
    expect(state.walletSpendLedgerEntries.map((entry) => entry.type)).toEqual([
      "deposit_credit",
    ]);
  });

  it("records the gateway mint only once per execution job", async () => {
    const store = await circleUserStore();
    const router = new FundingRouter(fakeTreasury({ balanceUsd: 500 }));
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    await router.ensureVenueUsdc({ store, ticket, job });
    await router.ensureVenueUsdc({ store, ticket, job });

    const state = await store.load();
    const mints = state.walletSpendLedgerEntries.filter((entry) => entry.type === "gateway_mint");
    expect(mints).toHaveLength(1);
  });
});

describe("circle-wallet execution (physical prefund)", () => {
  it("moves the ticket size from the deposit wallet to the treasury before executing", async () => {
    const store = await circleUserStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        venueOrderId: "sim:order_1",
        filledBaseSize: 59,
        filledSizeUsd: 25,
        averagePrice: 0.42,
      }),
    };
    const walletGateway = mockCircleWalletGateway({ balanceUsd: 100 });

    const result = await executeExecutionJob({
      jobId: job.jobId,
      store,
      executionClient,
      walletGateway,
    });

    expect(result.status).toBe("succeeded");
    expect(walletGateway.getUsdcBalanceUsd).toHaveBeenCalledWith({
      walletId: "circle_wallet_1",
    });
    expect(walletGateway.transferUserUsdcToTreasury).toHaveBeenCalledWith({
      userWalletId: "circle_wallet_1",
      amountUsd: 25,
      referenceId: `trade_prefund:${job.jobId}`,
      chain: "arc",
    });
    expect(executionClient.execute).toHaveBeenCalledWith(ticket, {
      funding: expect.objectContaining({
        chain: "arc",
        venueChain: "polygon",
        treasuryWalletAddress: TREASURY_ADDRESS,
      }),
    });
    const state = await store.load();
    // Simulated execution: no gateway_mint, no venue settlement.
    expect(state.walletSpendLedgerEntries.map((entry) => entry.type)).toEqual([
      "deposit_credit",
      "trade_reserve",
      "trade_prefund",
      "trade_spend",
    ]);
  });

  it("physically refunds the deposit wallet when the venue fails", async () => {
    const store = await circleUserStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockRejectedValue(new Error("venue unavailable")),
    };
    const walletGateway = mockCircleWalletGateway({ balanceUsd: 100 });

    const result = await executeExecutionJob({
      jobId: job.jobId,
      store,
      executionClient,
      walletGateway,
    });

    expect(result).toMatchObject({ status: "failed", failureReason: "venue unavailable" });
    expect(walletGateway.refundUserUsdcFromTreasury).toHaveBeenCalledWith({
      userWalletAddress: DEPOSIT_EVM_ADDRESS,
      amountUsd: 25,
      referenceId: `trade_refund:${job.jobId}`,
      chain: "arc",
    });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.reservedUsd).toBe(0);
  });

  it("rejects tickets when the deposit wallet balance is too small", async () => {
    const store = await circleUserStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    const walletGateway = mockCircleWalletGateway({ balanceUsd: 10 });

    const result = await executeExecutionJob({
      jobId: job.jobId,
      store,
      executionClient: { execute: vi.fn() },
      walletGateway,
    });

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "Insufficient user wallet balance.",
    });
    expect(walletGateway.transferUserUsdcToTreasury).not.toHaveBeenCalled();
  });
});

describe("circle-wallet position close (physical payout)", () => {
  it("pays the close proceeds from the treasury back to the deposit wallet", async () => {
    const store = await circleUserStore();
    await store.addTradeTicket(ticket);
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addExecutionJob(job);
    await store.addPosition({
      positionId: "position_1",
      userId: "x:x_1",
      ticketId: ticket.ticketId,
      executionJobId: job.jobId,
      venue: "polymarket",
      instrument: "solana-etf-approved",
      side: "buy_yes",
      status: "closing",
      entrySizeUsd: 25,
      filledBaseSize: 59,
      filledSizeUsd: 25,
      entryPrice: 0.42,
      currentMarkPrice: 0.5,
      currentValueUsd: 29.5,
      unrealizedPnlUsd: 4.5,
      unrealizedPnlPct: 18,
      exitPlan,
      openedAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      lastMarkedAt: "2026-07-01T00:00:00.000Z",
      closedAt: null,
      closeExecutionJobId: null,
      failureReason: null,
    });
    const walletGateway = mockCircleWalletGateway({ balanceUsd: 75 });

    const closed = await executeClosePosition({
      positionId: "position_1",
      store,
      closeClient: {
        async close() {
          return {
            venueOrderId: "sim:close_order_1",
            filledBaseSize: 59,
            filledSizeUsd: 29.5,
            averagePrice: 0.5,
          };
        },
      },
      walletGateway,
    });

    expect(closed.status).toBe("closed");
    // Profit case: the user receives more than they put in (25 -> 29.50).
    expect(walletGateway.refundUserUsdcFromTreasury).toHaveBeenCalledWith({
      userWalletAddress: DEPOSIT_EVM_ADDRESS,
      amountUsd: 29.5,
      referenceId: "position_close:position_1",
      chain: "arc",
    });
  });
});
