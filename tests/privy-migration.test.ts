import { describe, expect, it } from "vitest";
import {
  dismissPrivyMigration,
  markPrivyFundsMoved,
  shouldPromptPrivyMigration,
} from "../packages/app/privy-migration.ts";
import type { UserSettings } from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "did:privy:user_1",
  privyUserId: "did:privy:user_1",
  privyWalletId: "wallet_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
  defaultTradeSizeUsd: 50,
};

describe("Privy funds migration prompt", () => {
  it("prompts when Privy funds remain and a deposit address exists", () => {
    expect(shouldPromptPrivyMigration({
      settings,
      privyBalanceUsd: 25,
      hasDepositAddress: true,
    })).toBe(true);
  });

  it("does not prompt without a deposit address to move funds to", () => {
    expect(shouldPromptPrivyMigration({
      settings,
      privyBalanceUsd: 25,
      hasDepositAddress: false,
    })).toBe(false);
  });

  it("does not prompt when the Privy wallet is empty or absent", () => {
    expect(shouldPromptPrivyMigration({
      settings,
      privyBalanceUsd: 0,
      hasDepositAddress: true,
    })).toBe(false);
    expect(shouldPromptPrivyMigration({
      settings: { ...settings, privyWalletId: null },
      privyBalanceUsd: null,
      hasDepositAddress: true,
    })).toBe(false);
  });

  it("stays dismissed and stays completed", () => {
    const dismissed = dismissPrivyMigration(settings);
    expect(dismissed.migration?.privyFundsPromptDismissedAt).toBeTruthy();
    expect(shouldPromptPrivyMigration({
      settings: dismissed,
      privyBalanceUsd: 25,
      hasDepositAddress: true,
    })).toBe(false);

    const moved = markPrivyFundsMoved(settings);
    expect(moved.migration?.privyFundsMovedAt).toBeTruthy();
    expect(shouldPromptPrivyMigration({
      settings: moved,
      privyBalanceUsd: 25,
      hasDepositAddress: true,
    })).toBe(false);
  });
});
