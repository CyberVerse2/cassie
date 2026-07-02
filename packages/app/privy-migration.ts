import type { UserSettings } from "../core/schemas/index.ts";

// A user should be prompted to move Privy funds when they still hold USDC in
// a Privy embedded wallet, already have a Circle deposit address to move it
// to, and have not dismissed or completed the migration.
export function shouldPromptPrivyMigration(input: {
  settings: UserSettings;
  privyBalanceUsd: number | null;
  hasDepositAddress: boolean;
}): boolean {
  if (!input.hasDepositAddress) return false;
  if (!input.settings.privyWalletId) return false;
  if ((input.privyBalanceUsd ?? 0) <= 0) return false;
  const migration = input.settings.migration;
  if (migration?.privyFundsMovedAt) return false;
  if (migration?.privyFundsPromptDismissedAt) return false;
  return true;
}

export function dismissPrivyMigration(settings: UserSettings): UserSettings {
  return {
    ...settings,
    migration: {
      ...settings.migration,
      privyFundsPromptDismissedAt: new Date().toISOString(),
    },
  };
}

export function markPrivyFundsMoved(settings: UserSettings): UserSettings {
  return {
    ...settings,
    migration: {
      ...settings.migration,
      privyFundsMovedAt: new Date().toISOString(),
    },
  };
}
