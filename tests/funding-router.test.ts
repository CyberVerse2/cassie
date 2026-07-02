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

// Internal-ledger user: X login, no Privy wallet.
const settings: UserSettings = {
  userId: "x:x_1",
  privyUserId: null,
  privyWalletId: null,
  walletAddress: null,
  profile: { name: "Cassie", handle: "cassie", avatarUrl: null },
  x: { userId: "x_1", username: "cassie" },
  defaultTradeSizeUsd: 25,
};

function fakeTreasury(input: { balanceUsd: number }): TreasuryFundingGateway {
  return {
    getTreasuryWalletAddress: vi.fn().mockReturnValue("0x2222222222222222222222222222222222222222"),
    getTreasuryWalletId: vi.fn().mockReturnValue("treasury_wallet"),
    getUsdcBalanceOnChain: vi.fn().mockResolvedValue(input.balanceUsd),
  };
}

async function internalLedgerStore(depositUsd = 100) {
  const store = new InMemoryCassieStore();
  await store.upsertUserSettings(settings);
  await store.addUserDepositAddress({
    userId: settings.userId,
    walletSetId: "wallet_set_1",
    circleWalletId: "circle_wallet_1",
    evmAddress: "0xAAaA111111111111111111111111111111111111",
    createdAt: "2026-07-01T00:00:00.000Z",
  });
  await store.recordDepositCredit({
    userId: settings.userId,
    amountUsd: depositUsd,
    chain: "base",
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

  it("records prefund and gateway mint entries and returns venue-chain funding", async () => {
    const store = await internalLedgerStore();
    const treasury = fakeTreasury({ balanceUsd: 500 });
    const router = new FundingRouter(treasury, false);
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const funding = await router.ensureVenueUsdc({
      store,
      ticket,
      job,
      walletBalanceUsd: 100,
    });

    expect(funding).toMatchObject({
      type: "cassie_treasury",
      userId: "x:x_1",
      treasuryWalletAddress: "0x2222222222222222222222222222222222222222",
      prefundTransferId: `ledger:${job.jobId}`,
      prefundTransferStatus: "succeeded",
      amountUsd: 25,
      chain: "polygon",
      venueChain: "polygon",
    });
    expect(treasury.getUsdcBalanceOnChain).toHaveBeenCalledWith({
      walletId: "treasury_wallet",
      chain: "polygon",
    });
    const state = await store.load();
    const types = state.walletSpendLedgerEntries.map((entry) => entry.type);
    expect(types).toEqual(["deposit_credit", "trade_prefund", "gateway_mint"]);
  });

  it("throws before recording anything when the treasury lacks venue-chain USDC", async () => {
    const store = await internalLedgerStore();
    const router = new FundingRouter(fakeTreasury({ balanceUsd: 10 }), false);
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    await expect(
      router.ensureVenueUsdc({ store, ticket, job, walletBalanceUsd: 100 }),
    ).rejects.toThrow(/Treasury holds \$10\.00 USDC on polygon/);
    const state = await store.load();
    expect(state.walletSpendLedgerEntries.map((entry) => entry.type)).toEqual([
      "deposit_credit",
    ]);
  });

  it("records the gateway mint only once per execution job", async () => {
    const store = await internalLedgerStore();
    const router = new FundingRouter(fakeTreasury({ balanceUsd: 500 }), false);
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    await router.ensureVenueUsdc({ store, ticket, job, walletBalanceUsd: 100 });
    await router.ensureVenueUsdc({ store, ticket, job, walletBalanceUsd: 100 });

    const state = await store.load();
    const mints = state.walletSpendLedgerEntries.filter((entry) => entry.type === "gateway_mint");
    expect(mints).toHaveLength(1);
  });
});

describe("internal-ledger execution", () => {
  it("funds a trade from the internal ledger without touching Privy", async () => {
    const store = await internalLedgerStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        venueOrderId: "order_1",
        filledBaseSize: 59,
        filledSizeUsd: 25,
        averagePrice: 0.42,
      }),
    };
    const walletGateway = {
      getUsdcBalanceUsd: vi.fn(),
      getTreasuryWalletAddress: vi.fn(),
      transferUserUsdcToTreasury: vi.fn(),
      refundUserUsdcFromTreasury: vi.fn(),
    };
    const fundingRouter = new FundingRouter(fakeTreasury({ balanceUsd: 500 }), false);

    const result = await executeExecutionJob({
      jobId: job.jobId,
      store,
      executionClient,
      walletGateway,
      fundingRouter,
    });

    expect(result.status).toBe("succeeded");
    expect(walletGateway.getUsdcBalanceUsd).not.toHaveBeenCalled();
    expect(walletGateway.transferUserUsdcToTreasury).not.toHaveBeenCalled();
    expect(walletGateway.refundUserUsdcFromTreasury).not.toHaveBeenCalled();
    expect(executionClient.execute).toHaveBeenCalledWith(ticket, {
      funding: expect.objectContaining({ venueChain: "polygon" }),
    });
    const state = await store.load();
    expect(state.walletSpendLedgerEntries.map((entry) => entry.type)).toEqual([
      "deposit_credit",
      "trade_reserve",
      "trade_prefund",
      "gateway_mint",
      "trade_spend",
    ]);
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(75);
    expect(balance.spendableUsd).toBe(75);
  });

  it("releases the reservation and restores spendable balance when the venue fails", async () => {
    const store = await internalLedgerStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockRejectedValue(new Error("venue unavailable")),
    };
    const fundingRouter = new FundingRouter(fakeTreasury({ balanceUsd: 500 }), false);

    const result = await executeExecutionJob({
      jobId: job.jobId,
      store,
      executionClient,
      walletGateway: {
        getUsdcBalanceUsd: vi.fn(),
        getTreasuryWalletAddress: vi.fn(),
        transferUserUsdcToTreasury: vi.fn(),
        refundUserUsdcFromTreasury: vi.fn(),
      },
      fundingRouter,
    });

    expect(result).toMatchObject({ status: "failed", failureReason: "venue unavailable" });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(100);
    expect(balance.reservedUsd).toBe(0);
    expect(balance.spendableUsd).toBe(100);
  });

  it("rejects tickets when the credited balance is too small", async () => {
    const store = await internalLedgerStore(10);
    const job = createQueuedExecutionJob(ticket.ticketId);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({
      jobId: job.jobId,
      store,
      executionClient: { execute: vi.fn() },
      walletGateway: {
        getUsdcBalanceUsd: vi.fn(),
        getTreasuryWalletAddress: vi.fn(),
        transferUserUsdcToTreasury: vi.fn(),
        refundUserUsdcFromTreasury: vi.fn(),
      },
      fundingRouter: new FundingRouter(fakeTreasury({ balanceUsd: 500 }), false),
    });

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "Insufficient user wallet balance.",
    });
  });
});

describe("internal-ledger position close", () => {
  it("credits the close proceeds to the internal ledger", async () => {
    const store = await internalLedgerStore();
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

    const closed = await executeClosePosition({
      positionId: "position_1",
      store,
      closeClient: {
        async close() {
          return {
            venueOrderId: "close_order_1",
            filledBaseSize: 59,
            filledSizeUsd: 29.5,
            averagePrice: 0.5,
          };
        },
      },
    });

    expect(closed.status).toBe("closed");
    const state = await store.load();
    const credits = state.walletSpendLedgerEntries.filter((entry) => entry.type === "refund_credit");
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      userId: "x:x_1",
      amountUsd: 29.5,
      circleTransferId: "position_close:position_1",
    });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(129.5);
  });
});
