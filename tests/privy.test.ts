import { describe, expect, it } from "vitest";
import { syncPrivyAccount } from "../packages/adapters/privy/index.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";

describe("Privy account sync", () => {
  it("stores the user-controlled Privy wallet identity without creating spend ledger entries", async () => {
    const store = new InMemoryCassieStore();

    const settings = await syncPrivyAccount({
      store,
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
      defaultTradeSizeUsd: 25,
    });

    expect(settings).toMatchObject({
      userId: "did:privy:user_1",
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
      defaultTradeSizeUsd: 25,
    });
    expect((await store.load()).walletSpendLedgerEntries).toEqual([]);
  });
});
