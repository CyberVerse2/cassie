import { Wallet } from "ethers";
import type { UserSettings } from "../packages/core/schemas/index.ts";

export type CliSettingsFlags = Record<string, string | boolean>;

export type GeneratedCliWallet = {
  address: string;
  privateKey: string;
  mnemonic: string | null;
};

export function buildCliUserSettings(
  flags: CliSettingsFlags,
  options: { defaultUserId: string; existingSettings?: UserSettings | null },
): {
  settings: UserSettings;
  generatedWallet: GeneratedCliWallet | null;
} {
  const existingSettings = options.existingSettings ?? null;
  const userId = flag(flags, "user", options.defaultUserId);
  const providedWallet = nullableFlag(flags, "wallet");
  const shouldGenerateWallet =
    !providedWallet && !existingSettings?.walletAddress;
  const generatedWallet = shouldGenerateWallet ? generateCliWallet() : null;
  const walletAddress =
    providedWallet ??
    existingSettings?.walletAddress ??
    generatedWallet?.address;
  if (!walletAddress) {
    throw new Error("CLI wallet generation failed.");
  }
  const settings: UserSettings = {
    ...existingSettings,
    userId,
    privyUserId: existingSettings?.privyUserId ?? null,
    privyWalletId: existingSettings?.privyWalletId ?? null,
    walletAddress,
    profile: existingSettings?.profile ?? {
      name: "Cassie CLI",
      handle: "@cassie-cli",
      avatarUrl: null,
    },
    defaultTradeSizeUsd: numberFlag(
      flags,
      "size",
      existingSettings?.defaultTradeSizeUsd ?? 50,
    ),
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

function flag(
  flags: CliSettingsFlags,
  name: string,
  defaultValue: string,
): string {
  const value = flags[name];
  return typeof value === "string" ? value : defaultValue;
}

function nullableFlag(flags: CliSettingsFlags, name: string): string | null {
  const value = flags[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberFlag(
  flags: CliSettingsFlags,
  name: string,
  defaultValue: number,
): number {
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
