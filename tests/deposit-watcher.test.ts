import { describe, expect, it, vi } from "vitest";
import type { CircleIncomingTransfer } from "../packages/adapters/circle/index.ts";
import { sweepDeposit } from "../packages/app/deposit-sweeper.ts";
import { pollDeposits } from "../packages/app/deposit-watcher.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";

const TREASURY_ADDRESS = "0x2222222222222222222222222222222222222222";

const depositAddress = {
  userId: "user_1",
  walletSetId: "wallet_set_1",
  circleWalletId: "circle_wallet_1",
  evmAddress: "0xAAaA111111111111111111111111111111111111",
  createdAt: "2026-07-01T00:00:00.000Z",
};

function transfer(overrides: Partial<CircleIncomingTransfer> = {}): CircleIncomingTransfer {
  return {
    transferId: "transfer_1",
    chain: "arbitrum",
    blockchain: "ARB",
    sourceAddress: "0xcccc333333333333333333333333333333333333",
    destinationAddress: depositAddress.evmAddress.toLowerCase(),
    amountUsd: 40,
    txHash: "0xhash1",
    tokenId: "usdc_token",
    state: "COMPLETE",
    createDate: "2026-07-01T01:00:00.000Z",
    ...overrides,
  };
}

async function storeWithUser() {
  const store = new InMemoryCassieStore();
  await store.syncXUser({
    xUserId: "x_1",
    username: "cassie",
    profile: { name: "Cassie", handle: "cassie", avatarUrl: null },
  });
  await store.addUserDepositAddress({ ...depositAddress, userId: "x:x_1" });
  return store;
}

describe("deposit watcher", () => {
  it("credits a matched USDC deposit", async () => {
    const store = await storeWithUser();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    const result = await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });

    expect(result).toMatchObject({ found: 1, credited: 1, skipped: 0, unmatched: 0 });
    const state = await store.load();
    const credits = state.walletSpendLedgerEntries.filter((entry) => entry.type === "deposit_credit");
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      userId: "x:x_1",
      amountUsd: 40,
      chain: "arbitrum",
      circleTransferId: "transfer_1",
    });
  });

  it("does not double-credit the same transfer across polls", async () => {
    const store = await storeWithUser();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });
    const second = await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });

    expect(second).toMatchObject({ credited: 0, skipped: 1 });
    const state = await store.load();
    expect(state.walletSpendLedgerEntries.filter((entry) => entry.type === "deposit_credit")).toHaveLength(1);
  });

  it("does not double-credit when the ledger already has the transfer", async () => {
    const store = await storeWithUser();
    await store.recordDepositCredit({
      userId: "x:x_1",
      amountUsd: 40,
      chain: "arbitrum",
      txHash: "0xhash1",
      circleTransferId: "transfer_1",
    });
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    const result = await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });

    expect(result).toMatchObject({ credited: 0, skipped: 1 });
  });

  it("skips treasury payouts instead of crediting them as deposits", async () => {
    const store = await storeWithUser();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([
        transfer({ sourceAddress: TREASURY_ADDRESS.toUpperCase() }),
      ]),
    };

    const result = await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });

    expect(result).toMatchObject({ found: 1, credited: 0, skipped: 1 });
    const state = await store.load();
    expect(state.walletSpendLedgerEntries.filter((entry) => entry.type === "deposit_credit")).toHaveLength(0);
  });

  it("advances the poll cursor and passes it to Circle", async () => {
    const store = await storeWithUser();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([transfer()]),
    };

    await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });
    expect(circle.listIncomingUsdcTransfers).toHaveBeenLastCalledWith({ from: undefined });

    circle.listIncomingUsdcTransfers.mockResolvedValue([]);
    await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });
    expect(circle.listIncomingUsdcTransfers).toHaveBeenLastCalledWith({
      from: "2026-07-01T01:00:00.000Z",
    });
  });

  it("counts transfers to unknown addresses as unmatched", async () => {
    const store = await storeWithUser();
    const circle = {
      listIncomingUsdcTransfers: vi.fn().mockResolvedValue([
        transfer({ destinationAddress: "0xbbbb222222222222222222222222222222222222" }),
      ]),
    };

    const result = await pollDeposits({ store, circle, treasuryAddress: TREASURY_ADDRESS });

    expect(result).toMatchObject({ credited: 0, unmatched: 1 });
  });
});

describe("deposit sweeper (ops-only)", () => {
  it("sweeps a deposit to the treasury exactly once when invoked", async () => {
    const store = await storeWithUser();
    const circle = {
      transferUserUsdcToTreasury: vi.fn().mockResolvedValue({
        transferId: "sweep_tx_1",
        referenceId: "deposit_sweep:transfer_1",
        status: "succeeded",
        sourceWalletId: "circle_wallet_1",
        destinationAddress: TREASURY_ADDRESS,
        amountUsd: 40,
        asset: "usdc",
        chain: "arbitrum",
        createdAt: "2026-07-01T02:00:00.000Z",
        raw: {},
      }),
    };
    const payload = {
      userId: "x:x_1",
      circleTransferId: "transfer_1",
      amountUsd: 40,
      chain: "arbitrum",
    };

    const first = await sweepDeposit({ payload, store, circle });
    const second = await sweepDeposit({ payload, store, circle });

    expect(first.status).toBe("swept");
    expect(second.status).toBe("duplicate");
    expect(circle.transferUserUsdcToTreasury).toHaveBeenCalledTimes(1);
  });
});
