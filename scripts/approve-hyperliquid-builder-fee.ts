import "dotenv/config";

import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { normalizePrivateKey } from "../packages/core/config.ts";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const MAX_PERP_BUILDER_FEE_PERCENT = 0.1;

async function main(): Promise<void> {
  const privateKey = requiredEnv("HYPERLIQUID_MAIN_PRIVATE_KEY");
  const builder = requiredEnv("HYPERLIQUID_BUILDER_ADDRESS");
  const maxFeeRate = requiredEnv("HYPERLIQUID_BUILDER_MAX_FEE_RATE");

  if (!ADDRESS_PATTERN.test(builder)) {
    throw new Error("HYPERLIQUID_BUILDER_ADDRESS must be a 20-byte 0x-prefixed address.");
  }

  const feePercent = parsePercent(maxFeeRate, "HYPERLIQUID_BUILDER_MAX_FEE_RATE");
  if (feePercent <= 0 || feePercent > MAX_PERP_BUILDER_FEE_PERCENT) {
    throw new Error("HYPERLIQUID_BUILDER_MAX_FEE_RATE must be greater than 0% and at most 0.1% for perps.");
  }

  const wallet = privateKeyToAccount(normalizePrivateKey(privateKey, "HYPERLIQUID_MAIN_PRIVATE_KEY"));
  const client = new ExchangeClient({
    transport: new HttpTransport(),
    wallet,
  });

  const response = await client.approveBuilderFee({
    builder: builder as `0x${string}`,
    maxFeeRate: `${feePercent}%`,
  });

  if (response.status !== "ok") {
    throw new Error(`Hyperliquid builder fee approval failed: ${JSON.stringify(response)}`);
  }

  console.log(`Approved ${builder} to charge up to ${feePercent}% builder fee for ${wallet.address}.`);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parsePercent(value: string, name: string): number {
  if (!value.endsWith("%")) {
    throw new Error(`${name} must be a percent string such as 0.1%.`);
  }
  const parsed = Number(value.slice(0, -1));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid percent string.`);
  }
  return parsed;
}

await main();
