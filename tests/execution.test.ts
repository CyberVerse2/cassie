import { describe, expect, it, vi } from "vitest";
import {
  HyperliquidExecutionClient,
  PolymarketExecutionClient,
  type ExecutionClient,
  type PolymarketSdkTradingClientLike,
} from "../packages/execution/index.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { TradeExitPlan, TradeTicket, UserSettings } from "../packages/core/schemas/index.ts";
import { executeExecutionJob } from "../packages/jobs/execution-job.ts";
import { createQueuedExecutionJob } from "../packages/jobs/state.ts";
import { formatDecimal, formatSignificantDecimal } from "../packages/execution/helpers/format.ts";
import type { XReplyClient } from "../packages/notifications/x.ts";

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
  userId: "user_1",
  thesis: "Solana ETF approval odds are mispriced.",
  venue: "polymarket",
  instrument: "solana-etf-approved",
  side: "buy_yes",
  sizeUsd: 25,
  orderType: "marketable_limit",
  venueData: {
    outcomeTokenId: "123",
  },
  exitPlan,
};
const builderCode = `0x${"a".repeat(64)}`;
const settings: UserSettings = {
  userId: "user_1",
  privyUserId: "did:privy:user_1",
  privyWalletId: "wallet_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
  defaultTradeSizeUsd: 25,
};

describe("execution decimal formatting", () => {
  it("trims fractional zeros without removing integer magnitude", () => {
    expect(formatDecimal(1000, 0)).toBe("1000");
    expect(formatDecimal(1000, 2)).toBe("1000");
    expect(formatSignificantDecimal(1000, 5)).toBe("1000");
  });
});

describe("HyperliquidExecutionClient", () => {
  it("submits exchange-valid IOC orders and reports actual fill size", async () => {
    const info = {
      metaAndAssetCtxs: vi.fn().mockResolvedValue([
        {
          universe: [
            { name: "BTC", szDecimals: 5 },
            { name: "ETH", szDecimals: 4 },
            { name: "SOL", szDecimals: 2 },
          ],
        },
        [],
      ]),
      allMids: vi.fn().mockResolvedValue({
        SOL: "83.0365",
      }),
    };
    const exchange = {
      updateLeverage: vi.fn().mockResolvedValue({ status: "ok" }),
      order: vi.fn().mockResolvedValue({
        status: "ok",
        response: {
          type: "order",
          data: {
            statuses: [
              {
                filled: {
                  totalSz: "0.15",
                  avgPx: "83.05",
                  oid: 12345,
                },
              },
            ],
          },
        },
      }),
    };
    const client = new HyperliquidExecutionClient({
      privateKey: `0x${"1".repeat(64)}`,
      slippageBps: 100,
      priceDecimals: 5,
      perpLeverage: 3,
      clientFactory: () => ({ info: info as never, exchange: exchange as never }),
    });

    const result = await client.execute({
      ticketId: "ticket_hl_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "SOL momentum.",
      venue: "hyperliquid",
      instrument: "SOL-PERP",
      side: "long",
      sizeUsd: 25,
      orderType: "marketable_limit",
      venueData: { symbol: "SOL" },
      exitPlan,
    });

    expect(exchange.updateLeverage).toHaveBeenCalledWith({ asset: 2, isCross: true, leverage: 3 });
    expect(exchange.order).toHaveBeenCalledWith({
      orders: [
        {
          a: 2,
          b: true,
          p: "83.867",
          s: "0.9",
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    });
    expect(result).toMatchObject({
      venueOrderId: "12345",
      filledBaseSize: 0.15,
      filledSizeUsd: 12.4575,
      collateralUsedUsd: 4.1525,
      averagePrice: 83.05,
    });
  });

  it("submits spot orders with spot asset ids", async () => {
    const spotCtxs = Array.from({ length: 183 }, (_, index) =>
      index === 182 ? { coin: "@182", midPx: "4507.75", markPx: "4507.6" } : {}
    );
    const info = {
      spotMetaAndAssetCtxs: vi.fn().mockResolvedValue([
        {
          tokens: [
            { name: "USDC", fullName: null, szDecimals: 8, index: 0, isCanonical: true },
            { name: "XAUT0", fullName: "XAUT0", szDecimals: 2, index: 297, isCanonical: false },
          ],
          universe: [
            { name: "@182", tokens: [297, 0], index: 182, isCanonical: false },
          ],
        },
        spotCtxs,
      ]),
      metaAndAssetCtxs: vi.fn(),
      allMids: vi.fn().mockResolvedValue({ "@182": "4507.75" }),
    };
    const exchange = {
      updateLeverage: vi.fn(),
      order: vi.fn().mockResolvedValue({
        status: "ok",
        response: {
          type: "order",
          data: {
            statuses: [
              {
                filled: {
                  totalSz: "0.01",
                  avgPx: "4508.5",
                  oid: 67890,
                },
              },
            ],
          },
        },
      }),
    };
    const client = new HyperliquidExecutionClient({
      privateKey: `0x${"1".repeat(64)}`,
      slippageBps: 100,
      priceDecimals: 5,
      perpLeverage: 3,
      clientFactory: () => ({ info: info as never, exchange: exchange as never }),
    });

    const result = await client.execute({
      ticketId: "ticket_hl_spot_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "Gold momentum.",
      venue: "hyperliquid",
      instrument: "spot",
      side: "buy",
      sizeUsd: 50,
      orderType: "marketable_limit",
      venueData: { symbol: "XAUT0/USDC" },
      exitPlan,
    });

    expect(exchange.updateLeverage).not.toHaveBeenCalled();
    expect(exchange.order).toHaveBeenCalledWith({
      orders: [
        {
          a: 10182,
          b: true,
          p: "4552.8",
          s: "0.01",
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    });
    expect(info.metaAndAssetCtxs).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      venueOrderId: "67890",
      filledBaseSize: 0.01,
      filledSizeUsd: 45.085,
      averagePrice: 4508.5,
    });
  });

  it("resolves deployer perp markets across the full Hyperliquid universe", async () => {
    const info = {
      perpDexs: vi.fn().mockResolvedValue([null, { name: "vntl" }]),
      metaAndAssetCtxs: vi.fn(async (input?: { dex?: string }) => {
        if (input?.dex === "vntl") {
          return [
            {
              universe: [
                { name: "vntl:OPENAI", szDecimals: 4, maxLeverage: 3 },
                { name: "vntl:SPACEX", szDecimals: 4, maxLeverage: 3, onlyIsolated: true },
              ],
            },
            [
              { coin: "vntl:OPENAI", markPx: "125.0" },
              { coin: "vntl:SPACEX", markPx: "1935.9" },
            ],
          ];
        }
        return [{ universe: [{ name: "BTC", szDecimals: 5 }] }, []];
      }),
      allMids: vi.fn().mockResolvedValue({}),
      spotMetaAndAssetCtxs: vi.fn(),
    };
    const exchange = {
      updateLeverage: vi.fn().mockResolvedValue({ status: "ok" }),
      order: vi.fn().mockResolvedValue({
        status: "ok",
        response: {
          type: "order",
          data: {
            statuses: [
              {
                filled: {
                  totalSz: "0.0077",
                  avgPx: "1934.0",
                  oid: 24680,
                },
              },
            ],
          },
        },
      }),
    };
    const client = new HyperliquidExecutionClient({
      privateKey: `0x${"1".repeat(64)}`,
      slippageBps: 100,
      priceDecimals: 5,
      perpLeverage: 3,
      clientFactory: () => ({ info: info as never, exchange: exchange as never }),
    });

    const result = await client.execute({
      ticketId: "ticket_hl_vntl_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "Short SpaceX valuation.",
      venue: "hyperliquid",
      instrument: "pre_stock_perp",
      side: "short",
      sizeUsd: 5,
      orderType: "marketable_limit",
      venueData: { symbol: "vntl:SPACEX" },
      exitPlan,
    });

    expect(info.perpDexs).toHaveBeenCalled();
    expect(info.metaAndAssetCtxs).toHaveBeenCalledWith({ dex: "vntl" });
    expect(exchange.updateLeverage).toHaveBeenCalledWith({ asset: 110001, isCross: false, leverage: 3 });
    expect(exchange.order).toHaveBeenCalledWith({
      orders: [
        {
          a: 110001,
          b: false,
          p: "1916.5",
          s: "0.0077",
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    });
    expect(result).toMatchObject({
      venueOrderId: "24680",
      filledBaseSize: 0.0077,
      filledSizeUsd: 14.8918,
      collateralUsedUsd: 4.963933333333333,
      averagePrice: 1934,
    });
  });
});

describe("PolymarketExecutionClient", () => {
  it("uses the beta SDK client with configured credentials for market orders", async () => {
    const placeMarketOrder = vi.fn().mockResolvedValue({
      ok: true,
      orderId: "order_1",
      status: "matched",
      makingAmount: "25",
      takingAmount: "20",
      transactionsHashes: [],
      tradeIds: [],
    });
    const setupGaslessWallet = vi.fn();
    const factory = vi.fn(async (config): Promise<PolymarketSdkTradingClientLike> => {
      expect(config.host).toBe("https://clob.polymarket.com");
      expect(config.creds).toEqual({
        key: "key",
        secret: "secret",
        passphrase: "passphrase",
      });
      expect(config.signatureType).toBe(1);
      expect(config.funderAddress).toBe("0x193c2109089dD260811f1852C9B1521D6CCF1c6B");
      expect(config.builderCode).toBe(builderCode);
      return {
        isGaslessReady: vi.fn().mockResolvedValue(true),
        setupGaslessWallet,
        placeMarketOrder,
      };
    });

    const client = new PolymarketExecutionClient({
      privateKey: `0x${"1".repeat(64)}`,
      apiKey: "key",
      apiSecret: "secret",
      apiPassphrase: "passphrase",
      signatureType: 1,
      funderAddress: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
      builderCode,
      relayerApiKey: "relayer-key",
      relayerApiKeyAddress: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
      host: "https://clob.polymarket.com",
      factory,
    });

    const result = await client.execute(ticket);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(setupGaslessWallet).not.toHaveBeenCalled();
    expect(placeMarketOrder).toHaveBeenCalledWith({
      tokenId: "123",
      amount: 25,
      side: "BUY",
      orderType: "FAK",
      builderCode,
    });
    expect(result).toMatchObject({
      venueOrderId: "order_1",
      filledBaseSize: null,
      filledSizeUsd: 25,
      averagePrice: null,
    });
  });

  it("surfaces missing relayer configuration before gasless setup", async () => {
    const client = new PolymarketExecutionClient({
      privateKey: `0x${"1".repeat(64)}`,
      apiKey: "key",
      apiSecret: "secret",
      apiPassphrase: "passphrase",
      funderAddress: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
      factory: async () => ({
        isGaslessReady: vi.fn().mockResolvedValue(false),
        setupGaslessWallet: vi.fn(),
        placeMarketOrder: vi.fn(),
      }),
    });

    await expect(client.execute(ticket))
      .rejects.toThrow("POLYMARKET_RELAYER_API_KEY, POLYMARKET_RELAYER_API_KEY_ADDRESS");
  });
});

describe("treasury-prefunded execution", () => {
  it("does not submit venue orders without enough wallet balance", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const executionClient: ExecutionClient = {
      execute: vi.fn(),
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 10 });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway });

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "Insufficient user wallet balance.",
    });
    expect(executionClient.execute).not.toHaveBeenCalled();
    expect(walletGateway.transferUserUsdcToTreasury).not.toHaveBeenCalled();
    await expect(store.getExecutionJob(job.jobId)).resolves.toMatchObject({
      status: "failed",
      failureReason: "Insufficient user wallet balance.",
    });
  });

  it("prefunds treasury from the signer-provisioned user wallet before execution", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const execute = vi.fn().mockResolvedValue({
      venueOrderId: "venue_order_1",
      filledBaseSize: 50,
      filledSizeUsd: 25,
      averagePrice: 0.5,
    });
    const executionClient: ExecutionClient = {
      execute,
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway });
    const state = await store.load();

    expect(result.status).toBe("succeeded");
    expect(walletGateway.transferUserUsdcToTreasury).toHaveBeenCalledWith({
      userWalletId: "wallet_1",
      amountUsd: 25,
      referenceId: `trade_prefund:${job.jobId}`,
    });
    expect(executionClient.execute).toHaveBeenCalledWith(ticket, {
      funding: {
        type: "cassie_treasury",
        userId: "user_1",
        treasuryWalletAddress: "0x2222222222222222222222222222222222222222",
        prefundTransferId: "transfer_prefund",
        prefundTransferStatus: "succeeded",
        amountUsd: 25,
      },
    });
    expect(walletGateway.transferUserUsdcToTreasury.mock.invocationCallOrder[0]!)
      .toBeLessThan(execute.mock.invocationCallOrder[0]!);
    expect(state.walletSpendLedgerEntries.map((entry) => entry.type)).toEqual([
      "trade_reserve",
      "trade_prefund",
      "trade_spend",
    ]);
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0]).toMatchObject({
      userId: "user_1",
      ticketId: ticket.ticketId,
      executionJobId: job.jobId,
      venue: "polymarket",
      instrument: "solana-etf-approved",
      side: "buy_yes",
      status: "open",
      entrySizeUsd: 25,
      filledBaseSize: 50,
      filledSizeUsd: 25,
      entryPrice: 0.5,
      currentMarkPrice: 0.5,
      currentValueUsd: 25,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      exitPlan,
    });
  });

  it("replies to the source tweet with the trade share link after a position opens", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        venueOrderId: "venue_order_1",
        filledBaseSize: 50,
        filledSizeUsd: 25,
        averagePrice: 0.5,
      }),
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });
    const xReplyClient = new FakeXReplyClient();

    await store.upsertUserSettings(settings);
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@cassiedottrade trade this",
      sourcePost: {
        platform: "x",
        postId: "tweet_1",
        url: "https://x.com/source/status/tweet_1",
        authorHandle: "source",
        authorName: "Source",
        text: "@cassiedottrade trade this",
        createdAt: "2026-06-05T10:00:00.000Z",
        quotedPostText: null,
        linkedUrls: [],
        mediaDescriptions: [],
      },
    });
    await store.addTradeTicket({ ...ticket, runId: run.runId });
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway, xReplyClient });
    const state = await store.load();
    const position = state.positions[0];

    expect(result.status).toBe("succeeded");
    expect(position).toBeDefined();
    expect(xReplyClient.replies).toEqual([{
      inReplyToTweetId: "tweet_1",
      text: `Trade is live.\nhttps://cassie.trade/trades/${position!.positionId}/pnl`,
    }]);
  });

  it("does not create a position when execution returns no fill", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        venueOrderId: "venue_order_1",
        filledSizeUsd: 0,
        averagePrice: null,
      }),
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway });
    const state = await store.load();

    expect(result.status).toBe("succeeded");
    expect(state.positions).toEqual([]);
  });

  it("persists execution-client setup failures instead of leaving jobs running", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });
    const getExecutionClient = vi.fn(() => {
      throw new Error("execution client unavailable");
    });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({
      jobId: job.jobId,
      store,
      getExecutionClient,
      walletGateway,
    });

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "execution client unavailable",
    });
    expect(getExecutionClient).toHaveBeenCalledOnce();
    expect(walletGateway.getUsdcBalanceUsd).not.toHaveBeenCalled();
    await expect(store.getExecutionJob(job.jobId)).resolves.toMatchObject({
      status: "failed",
      failureReason: "execution client unavailable",
    });
  });

  it("blocks execution before wallet movement when the ticket has no exit plan", async () => {
    const store = new InMemoryCassieStore();
    const legacyTicket = { ...ticket };
    delete (legacyTicket as Partial<TradeTicket>).exitPlan;
    const job = createQueuedExecutionJob(legacyTicket.ticketId);
    const executionClient: ExecutionClient = {
      execute: vi.fn(),
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(legacyTicket as TradeTicket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway });

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "Trade execution requires a valid exit plan.",
    });
    expect(walletGateway.getUsdcBalanceUsd).not.toHaveBeenCalled();
    expect(walletGateway.transferUserUsdcToTreasury).not.toHaveBeenCalled();
    expect(executionClient.execute).not.toHaveBeenCalled();
  });

  it("releases reserved wallet spend when venue execution fails", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockRejectedValue(new Error("venue unavailable")),
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway });
    const state = await store.load();

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "venue unavailable",
    });
    expect(walletGateway.refundUserUsdcFromTreasury).toHaveBeenCalledWith({
      userWalletAddress: "0x1111111111111111111111111111111111111111",
      amountUsd: 25,
      referenceId: `trade_refund:${job.jobId}`,
    });
    expect(state.walletSpendLedgerEntries.map((entry) => entry.type)).toEqual([
      "trade_reserve",
      "trade_prefund",
      "trade_release",
    ]);
  });

  it("does not submit venue orders while the treasury prefund is pending", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const executionClient: ExecutionClient = {
      execute: vi.fn(),
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });
    walletGateway.transferUserUsdcToTreasury.mockResolvedValueOnce({
      transferId: "transfer_pending",
      referenceId: `trade_prefund:${job.jobId}`,
      status: "pending",
      sourceWalletId: "wallet_1",
      destinationAddress: "0x2222222222222222222222222222222222222222",
      amountUsd: 25,
      asset: "usdc",
      chain: "base",
      createdAt: "2026-05-21T00:00:00.000Z",
      raw: {},
    });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway });
    const state = await store.load();
    const balance = await store.getWalletFundingBalance("user_1", 100);

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "Privy USDC prefund transfer_pending did not confirm before execution: pending.",
    });
    expect(executionClient.execute).not.toHaveBeenCalled();
    expect(walletGateway.refundUserUsdcFromTreasury).not.toHaveBeenCalled();
    expect(state.walletSpendLedgerEntries.map((entry) => entry.type)).toEqual([
      "trade_reserve",
      "trade_prefund",
    ]);
    expect(balance.reservedUsd).toBe(25);
  });

  it("refunds unfilled prefunded spend after a partial fill", async () => {
    const store = new InMemoryCassieStore();
    const job = createQueuedExecutionJob(ticket.ticketId);
    const executionClient: ExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        venueOrderId: "venue_order_1",
        filledBaseSize: 20,
        filledSizeUsd: 10,
        averagePrice: 0.5,
      }),
    };
    const walletGateway = mockWalletGateway({ balanceUsd: 100 });

    await store.upsertUserSettings(settings);
    await store.addTradeTicket(ticket);
    await store.addExecutionJob(job);

    const result = await executeExecutionJob({ jobId: job.jobId, store, executionClient, walletGateway });
    const state = await store.load();

    expect(result.status).toBe("succeeded");
    expect(walletGateway.refundUserUsdcFromTreasury).toHaveBeenCalledWith({
      userWalletAddress: "0x1111111111111111111111111111111111111111",
      amountUsd: 15,
      referenceId: `trade_release:${job.jobId}`,
    });
    expect(state.walletSpendLedgerEntries.map((entry) => ({
      type: entry.type,
      amountUsd: entry.amountUsd,
    }))).toEqual([
      { type: "trade_reserve", amountUsd: 25 },
      { type: "trade_prefund", amountUsd: 25 },
      { type: "trade_spend", amountUsd: 10 },
      { type: "trade_release", amountUsd: 15 },
    ]);
  });
});

function mockWalletGateway(input: { balanceUsd: number }) {
  return {
    getUsdcBalanceUsd: vi.fn().mockResolvedValue(input.balanceUsd),
    getTreasuryWalletAddress: vi.fn().mockReturnValue("0x2222222222222222222222222222222222222222"),
    transferUserUsdcToTreasury: vi.fn().mockResolvedValue({
      transferId: "transfer_prefund",
      referenceId: "trade_prefund:job_1",
      status: "succeeded",
      sourceWalletId: "wallet_1",
      destinationAddress: "0x2222222222222222222222222222222222222222",
      amountUsd: 25,
      asset: "usdc",
      chain: "base",
      createdAt: "2026-05-21T00:00:00.000Z",
      raw: {},
    }),
    refundUserUsdcFromTreasury: vi.fn().mockResolvedValue({
      transferId: "transfer_refund",
      referenceId: "trade_refund:job_1",
      status: "succeeded",
      sourceWalletId: "treasury_wallet",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amountUsd: 25,
      asset: "usdc",
      chain: "base",
      createdAt: "2026-05-21T00:00:00.000Z",
      raw: {},
    }),
  };
}

class FakeXReplyClient implements XReplyClient {
  replies: Array<{ inReplyToTweetId: string; text: string }> = [];

  async reply(input: { inReplyToTweetId: string; text: string }): Promise<{ tweetId: string }> {
    this.replies.push(input);
    return { tweetId: `reply_${this.replies.length}` };
  }
}
