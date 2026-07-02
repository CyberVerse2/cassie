import { CircleWalletAdapter } from "../adapters/circle/index.ts";
import { config } from "../core/config.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { SweepDepositPayload } from "../jobs/queue.ts";

export type SweepDepositResult = {
  status: "swept" | "duplicate" | "skipped";
  transferId?: string;
};

export type DepositSweepGateway = Pick<
  CircleWalletAdapter,
  "transferUserUsdcToTreasury"
>;

// Moves a credited deposit from the user's Circle deposit wallet into the
// treasury wallet, from which the Gateway unified balance is funded.
export async function sweepDeposit(input: {
  payload: SweepDepositPayload;
  store?: CassieStore;
  circle?: DepositSweepGateway;
}): Promise<SweepDepositResult> {
  const store = input.store ?? new DrizzleCassieStore();
  const circle = input.circle ?? new CircleWalletAdapter();
  const { payload } = input;

  const depositAddress = await store.getDepositAddress(payload.userId);
  if (!depositAddress) {
    return { status: "skipped" };
  }

  // At-most-once guard: a retry must never move funds twice. If a previous
  // attempt died after the marker but before the transfer, the funds stay in
  // the user's deposit wallet and can be re-swept manually.
  const sweepStateKey = `deposit_sweep:${payload.circleTransferId}`;
  if (await store.getRuntimeState(sweepStateKey)) {
    return { status: "duplicate" };
  }
  await store.setRuntimeState(sweepStateKey, {
    startedAt: new Date().toISOString(),
  });

  const chain = isChain(payload.chain) ? payload.chain : config.circle.defaultChain;
  const transfer = await circle.transferUserUsdcToTreasury({
    userWalletId: depositAddress.circleWalletId,
    amountUsd: payload.amountUsd,
    referenceId: `deposit_sweep:${payload.circleTransferId}`,
    chain,
  });

  const entry = await store.recordSweepToGateway({
    userId: payload.userId,
    amountUsd: payload.amountUsd,
    chain: payload.chain,
    circleTransferId: payload.circleTransferId,
    txHash: null,
    metadata: { transfer },
  });
  if (!entry) {
    return { status: "duplicate", transferId: transfer.transferId };
  }

  await store.audit({
    entityId: payload.userId,
    entityType: "user",
    eventType: "deposit.swept",
    message: "USDC deposit swept to treasury.",
    data: { payload, transfer },
  });
  return { status: "swept", transferId: transfer.transferId };
}

const CHAINS = new Set([
  "arc",
  "base",
  "arbitrum",
  "ethereum",
  "optimism",
  "polygon",
  "avalanche",
]);

function isChain(value: string | null): value is
  "arc" | "base" | "arbitrum" | "ethereum" | "optimism" | "polygon" | "avalanche" {
  return value != null && CHAINS.has(value);
}
