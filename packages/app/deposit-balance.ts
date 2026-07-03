import { CircleWalletAdapter } from "../adapters/circle/index.ts";
import { PrivyAdapter } from "../adapters/privy/index.ts";
import { config } from "../core/config.ts";
import type { CassieStore } from "../core/db/store.ts";
import { MissingConnectorConfigError } from "../core/helpers/connector-errors.ts";
import type { Chain, UserDepositAddress, UserSettings } from "../core/schemas/index.ts";

const BALANCE_CACHE_TTL_MS = 15_000;

const sharedAdapterKey = Symbol.for("cassie.circle.adapter");
const balanceCacheKey = Symbol.for("cassie.circle.balance-cache");

type CassieGlobal = typeof globalThis & {
  [sharedAdapterKey]?: CircleWalletAdapter;
  [balanceCacheKey]?: Map<string, { at: number; value: Promise<number | null> }>;
};

// One adapter per process so the per-chain wallet-derivation cache survives
// across requests (a fresh adapter re-derives every chain on every call).
export function sharedCircleAdapter(): CircleWalletAdapter {
  const globalScope = globalThis as CassieGlobal;
  globalScope[sharedAdapterKey] ??= new CircleWalletAdapter();
  return globalScope[sharedAdapterKey];
}

// Drops the cached balance for one wallet — call after moving money (e.g. the
// starter grant) so the next read reflects the transfer instead of a value up
// to BALANCE_CACHE_TTL_MS stale.
export function invalidateDepositWalletBalance(circleWalletId: string): void {
  const globalScope = globalThis as CassieGlobal;
  globalScope[balanceCacheKey]?.delete(circleWalletId);
}

// Balances are physical: the user's USDC sits in their Circle deposit wallet
// and moves to/from the treasury as trades open and close. Only chains that
// have ever received a deposit (plus the default chain) are queried, and
// results are cached briefly so /api/account and /api/dashboard within one
// page load don't double-fetch. Returns null when Circle is not configured.
export async function depositWalletBalanceUsd(
  depositAddress: UserDepositAddress,
  store?: CassieStore,
): Promise<number | null> {
  const globalScope = globalThis as CassieGlobal;
  const cache = (globalScope[balanceCacheKey] ??= new Map());
  const now = Date.now();
  const cached = cache.get(depositAddress.circleWalletId);
  if (cached && now - cached.at < BALANCE_CACHE_TTL_MS) return cached.value;

  const value = readBalance(depositAddress, store).catch((error) => {
    cache.delete(depositAddress.circleWalletId);
    throw error;
  });
  cache.set(depositAddress.circleWalletId, { at: now, value });
  return value;
}

async function readBalance(
  depositAddress: UserDepositAddress,
  store?: CassieStore,
): Promise<number | null> {
  try {
    const circle = sharedCircleAdapter();
    const chains = await activeDepositChains(depositAddress.userId, store);
    return await circle.getUsdcBalanceUsd({
      walletId: depositAddress.circleWalletId,
      chains,
    });
  } catch (error) {
    if (error instanceof MissingConnectorConfigError) return null;
    throw error;
  }
}

// A user's total USDC across the legacy Privy wallet (if any) and their
// Circle deposit wallet. Returns null only when neither wallet is readable.
export async function resolveUserWalletBalanceUsd(
  store: CassieStore,
  settings: UserSettings,
): Promise<number | null> {
  const privyBalanceUsd = settings.privyWalletId
    ? await new PrivyAdapter()
        .getUsdcBalanceUsd({ walletId: settings.privyWalletId })
        .catch(() => null)
    : null;
  const depositAddress = await store.getDepositAddress(settings.userId);
  const circleBalanceUsd = depositAddress
    ? await depositWalletBalanceUsd(depositAddress, store)
    : null;
  if (privyBalanceUsd == null && circleBalanceUsd == null) return null;
  return (privyBalanceUsd ?? 0) + (circleBalanceUsd ?? 0);
}

async function activeDepositChains(
  userId: string,
  store?: CassieStore,
): Promise<Chain[]> {
  const chains = new Set<Chain>([config.circle.defaultChain]);
  if (store) {
    const credits = await store.listUserDepositCredits(userId);
    for (const credit of credits) {
      if (credit.chain) chains.add(credit.chain as Chain);
    }
  }
  return [...chains];
}
