import { describe, expect, it, vi } from "vitest";
import { processCircleNotification } from "../packages/app/circle-webhook.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";

const DEPOSIT_ADDRESS = "0xAAaA111111111111111111111111111111111111";

async function storeWithDepositAddress() {
  const store = new InMemoryCassieStore();
  await store.syncXUser({
    xUserId: "x_1",
    username: "cassie",
    profile: { name: "Cassie", handle: "cassie", avatarUrl: null },
  });
  await store.addUserDepositAddress({
    userId: "x:x_1",
    walletSetId: "wallet_set_1",
    circleWalletId: "circle_wallet_1",
    evmAddress: DEPOSIT_ADDRESS,
    createdAt: "2026-07-01T00:00:00.000Z",
  });
  return store;
}

function fakeCircle(transferOverrides: Record<string, unknown> = {}) {
  return {
    toIncomingUsdcTransfer: vi.fn().mockResolvedValue({
      transferId: "wh_1",
      chain: "arc",
      blockchain: "ARC-TESTNET",
      sourceAddress: "0xcccc",
      destinationAddress: DEPOSIT_ADDRESS,
      amountUsd: 25,
      txHash: "0xhash",
      tokenId: "usdc",
      state: "COMPLETE",
      createDate: "2026-07-02T00:00:00.000Z",
      ...transferOverrides,
    }),
  } as never;
}

describe("Circle webhook processing", () => {
  it("acknowledges subscription confirmations", async () => {
    const store = await storeWithDepositAddress();
    const result = await processCircleNotification({
      store,
      payload: { notificationType: "subscriptions.confirmation" },
      circle: fakeCircle(),
    });
    expect(result).toEqual({ kind: "confirmation" });
  });

  it("credits an inbound USDC notification", async () => {
    const store = await storeWithDepositAddress();
    const result = await processCircleNotification({
      store,
      payload: {
        notificationType: "transactions.inbound",
        notification: { id: "wh_1" },
      },
      circle: fakeCircle(),
    });
    expect(result).toMatchObject({ kind: "transaction", status: "credited", userId: "x:x_1" });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(25);
  });

  it("does not credit pending transactions", async () => {
    const store = await storeWithDepositAddress();
    const result = await processCircleNotification({
      store,
      payload: {
        notificationType: "transactions.inbound",
        notification: { id: "wh_1" },
      },
      circle: fakeCircle({ state: "SENT" }),
    });
    expect(result).toMatchObject({ kind: "ignored" });
    const balance = await store.getDepositFundingBalance("x:x_1");
    expect(balance.walletBalanceUsd).toBe(0);
  });

  it("ignores non-transaction notifications", async () => {
    const store = await storeWithDepositAddress();
    const result = await processCircleNotification({
      store,
      payload: { notificationType: "wallets.updated" },
      circle: fakeCircle(),
    });
    expect(result).toMatchObject({ kind: "ignored" });
  });
});
