import { Wallet } from "ethers";
import type { UserSettings } from "../packages/core/schemas/index.ts";

export type CliSettingsFlags = Record<string, string | boolean>;

export type GeneratedCliWallet = {
  address: string;
  privateKey: string;
  mnemonic: string | null;
};

export function buildCliUserSettings(flags: CliSettingsFlags): {
  settings: UserSettings;
  generatedWallet: GeneratedCliWallet | null;
} {
  const providedWallet = nullableFlag(flags, "wallet");
  const generatedWallet = providedWallet ? null : generateCliWallet();
  const walletAddress = providedWallet ?? generatedWallet?.address;
  if (!walletAddress) {
    throw new Error("CLI wallet generation failed.");
  }
  const settings: UserSettings = {
    userId: flag(flags, "user", "local-user"),
    walletAddress,
    allowedVenues: csvFlag(flags, "venues", ["hyperliquid", "polymarket"]),
    allowedAssets: csvFlag(flags, "assets", ["SOL"]),
    defaultTradeSizeUsd: numberFlag(flags, "size", 50),
    maxTradeSizeUsd: numberFlag(flags, "max-size", 100),
    maxDailyLossUsd: numberFlag(flags, "max-daily-loss", 100),
    minConfidence: numberFlag(flags, "min-confidence", 0.75),
    maxSpreadBps: numberFlag(flags, "max-spread-bps", 50),
    maxSlippageBps: numberFlag(flags, "max-slippage-bps", 100),
    maxPositionUsd: numberFlag(flags, "max-position", 1_000),
    autoTradeEnabled: booleanFlag(flags, "auto-trade", false),
  };

  return { settings, generatedWallet };
}

function generateCliWallet(): GeneratedCliWallet {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase ?? null,
  };
}

function flag(flags: CliSettingsFlags, name: string, defaultValue: string): string {
  const value = flags[name];
  return typeof value === "string" ? value : defaultValue;
}

function nullableFlag(flags: CliSettingsFlags, name: string): string | null {
  const value = flags[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function csvFlag(flags: CliSettingsFlags, name: string, defaultValue: string[]): string[] {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    return defaultValue;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function numberFlag(flags: CliSettingsFlags, name: string, defaultValue: number): number {
  const value = flags[name];
  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a number.`);
  }
  return parsed;
}

function booleanFlag(flags: CliSettingsFlags, name: string, defaultValue: boolean): boolean {
  const value = flags[name];
  if (value == null) {
    return defaultValue;
  }

  if (value === true || value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`--${name} must be true or false.`);
}
