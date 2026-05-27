import { describe, expect, it, vi } from "vitest";
import { PolymarketExecutionClient, type PolymarketSdkTradingClientLike } from "../packages/execution/index.ts";
import type { TradeTicket } from "../packages/core/schemas/index.ts";

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
  riskDecision: {
    decision: "approve",
    adjustedSizeUsd: 25,
  },
};
const builderCode = `0x${"a".repeat(64)}`;

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
