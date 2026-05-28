import { describe, expect, it } from "vitest";
import {
  sweepPrivyUserWallet,
  type PrivySweepResult,
  type PrivyWalletGateway,
} from "../packages/adapters/privy/index.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { UserSettings } from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "user_1",
  privyUserId: "did:privy:user_1",
  privyWalletId: "wallet_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  defaultTradeSizeUsd: 50,
};

describe("Privy custody sweep", () => {
  it("credits swept wallet balance to the user's custody balance", async () => {
    const store = new InMemoryCassieStore();
    const gateway = new FakePrivyGateway(42);

    const result = await sweepPrivyUserWallet({
      store,
      settings,
      gateway,
      minSweepUsd: 1,
    });

    expect(result).toEqual({
      swept: true,
      amountUsd: 42,
      externalRef: "transfer_1",
    });
    expect(gateway.sweeps).toEqual([{ walletId: "wallet_1", amountUsd: 42 }]);
    expect(await store.getCustodyBalance("user_1")).toMatchObject({
      userId: "user_1",
      availableUsd: 42,
      reservedUsd: 0,
    });
  });

  it("does not sweep balances below the configured minimum", async () => {
    const store = new InMemoryCassieStore();
    const gateway = new FakePrivyGateway(0.5);

    const result = await sweepPrivyUserWallet({
      store,
      settings,
      gateway,
      minSweepUsd: 1,
    });

    expect(result).toEqual({
      swept: false,
      amountUsd: 0.5,
      externalRef: null,
    });
    expect(gateway.sweeps).toEqual([]);
    expect(await store.getCustodyBalance("user_1")).toBeUndefined();
  });
});

class FakePrivyGateway implements Pick<PrivyWalletGateway, "getUsdcBalanceUsd" | "sweepUsdc"> {
  readonly sweeps: Array<{ walletId: string; amountUsd: number }> = [];

  constructor(private readonly balanceUsd: number) {}

  async getUsdcBalanceUsd(): Promise<number> {
    return this.balanceUsd;
  }

  async sweepUsdc(input: { walletId: string; amountUsd: number }): Promise<PrivySweepResult> {
    this.sweeps.push(input);
    return {
      actionId: "transfer_1",
      status: "submitted",
      raw: { id: "transfer_1", status: "submitted" },
    };
  }
}
