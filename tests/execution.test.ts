import { describe, expect, it, vi } from "vitest";
import { Chain, OrderType, Side, SignatureTypeV2, type ApiKeyCreds, type ClobClientOptions } from "@polymarket/clob-client-v2";
import { PolymarketExecutionClient, type PolymarketClobClientLike } from "../packages/execution/index.ts";
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
  approvalState: "approved",
};

describe("PolymarketExecutionClient", () => {
  it("uses the v2 CLOB client with configured L2 credentials for market orders", async () => {
    const postMarketOrder = vi.fn().mockResolvedValue({
      orderID: "order_1",
      status: "matched",
    });
    const getTickSize = vi.fn().mockResolvedValue("0.01");
    const getNegRisk = vi.fn().mockResolvedValue(false);
    const factory = vi.fn((options: ClobClientOptions): PolymarketClobClientLike => {
      expect(options.host).toBe("https://clob.polymarket.com");
      expect(options.chain).toBe(Chain.POLYGON);
      expect(options.creds).toEqual({
        key: "key",
        secret: "secret",
        passphrase: "passphrase",
      } satisfies ApiKeyCreds);
      expect(options.signatureType).toBe(SignatureTypeV2.POLY_PROXY);
      expect(options.funderAddress).toBe("0x193c2109089dD260811f1852C9B1521D6CCF1c6B");
      expect(options.signer).toBeDefined();
      return {
        createAndPostMarketOrder: postMarketOrder,
        getTickSize,
        getNegRisk,
      };
    });

    const client = new PolymarketExecutionClient({
      privateKey: `0x${"1".repeat(64)}`,
      apiKey: "key",
      apiSecret: "secret",
      apiPassphrase: "passphrase",
      signatureType: SignatureTypeV2.POLY_PROXY,
      funderAddress: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
      host: "https://clob.polymarket.com",
      factory,
    });

    const result = await client.execute(ticket);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(getTickSize).toHaveBeenCalledWith("123");
    expect(getNegRisk).toHaveBeenCalledWith("123");
    expect(postMarketOrder).toHaveBeenCalledWith(
      {
        tokenID: "123",
        amount: 25,
        side: Side.BUY,
        orderType: OrderType.FAK,
      },
      { tickSize: "0.01", negRisk: false },
      OrderType.FAK,
    );
    expect(result).toMatchObject({
      venueOrderId: "order_1",
      filledSizeUsd: 25,
      averagePrice: null,
    });
  });
});
