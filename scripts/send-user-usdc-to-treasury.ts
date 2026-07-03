import "dotenv/config";

import { CircleWalletAdapter } from "../packages/adapters/circle/index.ts";
import { config } from "../packages/core/config.ts";
import { DrizzleCassieStore } from "../packages/core/db/drizzle-store.ts";

// Sends USDC from a user's Circle deposit wallet to the treasury.
// Usage: npx tsx scripts/send-user-usdc-to-treasury.ts [handle] [amountUsd]
const handle = process.argv[2] ?? "thecyberverse";
const amountUsd = Number(process.argv[3] ?? 100);
if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
  throw new Error(`Amount must be a positive USD value, got "${process.argv[3]}".`);
}

const store = new DrizzleCassieStore();
const settings = await store.getUserSettingsByXIdentity({ username: handle });
if (!settings) throw new Error(`No user found for @${handle}.`);

const deposit = await store.getDepositAddress(settings.userId);
if (!deposit) throw new Error(`@${handle} has no Circle deposit wallet.`);

const circle = new CircleWalletAdapter();
const chain = config.circle.defaultChain;
const balanceUsd = await circle.getUsdcBalanceOnChain({
  walletId: deposit.circleWalletId,
  chain,
});
console.log(`@${handle} (${settings.userId})`);
console.log(`wallet ${deposit.evmAddress} · $${balanceUsd} USDC on ${chain}`);
if (balanceUsd < amountUsd) {
  throw new Error(`Balance $${balanceUsd} is less than the requested $${amountUsd}.`);
}

console.log(`sending $${amountUsd} to the treasury…`);
const transfer = await circle.transferUserUsdcToTreasury({
  userWalletId: deposit.circleWalletId,
  amountUsd,
  referenceId: `manual-treasury:${settings.userId}:${Date.now()}`,
  chain,
});
console.log(`${transfer.status}: transfer ${transfer.transferId}`);
console.log(`→ ${transfer.destinationAddress} · $${transfer.amountUsd} on ${transfer.chain}`);
process.exit(0);
