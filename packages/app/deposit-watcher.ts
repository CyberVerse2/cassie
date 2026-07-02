import {
  CircleWalletAdapter,
  type CircleIncomingTransfer,
} from "../adapters/circle/index.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import { GraphileExecutionJobQueue, type CassieJobQueue } from "../jobs/queue.ts";

const DEPOSITS_POLL_CURSOR_KEY = "deposits_poll:cursor";

export type PollDepositsResult = {
  found: number;
  credited: number;
  skipped: number;
  unmatched: number;
  errors: Array<{ transferId?: string; error: string }>;
};

export type IncomingTransferSource = Pick<
  CircleWalletAdapter,
  "listIncomingUsdcTransfers"
>;

export async function pollDeposits(input: {
  store?: CassieStore;
  circle?: IncomingTransferSource;
  jobQueue?: CassieJobQueue;
} = {}): Promise<PollDepositsResult> {
  const store = input.store ?? new DrizzleCassieStore();
  const circle = input.circle ?? new CircleWalletAdapter();
  const jobQueue = input.jobQueue ?? new GraphileExecutionJobQueue();

  const cursor = await depositsPollCursor(store);
  const transfers = await circle.listIncomingUsdcTransfers({ from: cursor });
  const sorted = [...transfers].sort((left, right) =>
    left.createDate.localeCompare(right.createDate),
  );

  const result: PollDepositsResult = {
    found: transfers.length,
    credited: 0,
    skipped: 0,
    unmatched: 0,
    errors: [],
  };

  for (const transfer of sorted) {
    const pollStateKey = `deposits_poll:${transfer.transferId}`;
    try {
      if (await store.getRuntimeState(pollStateKey)) {
        result.skipped += 1;
        continue;
      }

      const processed = await creditDeposit({ store, jobQueue, transfer });
      await store.setRuntimeState(pollStateKey, {
        processedAt: new Date().toISOString(),
        result: processed,
      });
      if (processed.status === "credited") result.credited += 1;
      else if (processed.status === "duplicate") result.skipped += 1;
      else result.unmatched += 1;
    } catch (error) {
      result.errors.push({
        transferId: transfer.transferId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const newestCreateDate = sorted.at(-1)?.createDate;
  if (newestCreateDate && result.errors.length === 0) {
    await store.setRuntimeState(DEPOSITS_POLL_CURSOR_KEY, {
      cursor: newestCreateDate,
    });
  }

  return result;
}

async function creditDeposit(input: {
  store: CassieStore;
  jobQueue: CassieJobQueue;
  transfer: CircleIncomingTransfer;
}): Promise<{ status: "credited" | "duplicate" | "unmatched"; userId?: string }> {
  const { store, jobQueue, transfer } = input;
  const depositAddress = await store.getDepositAddressByEvmAddress(
    transfer.destinationAddress,
  );
  if (!depositAddress) {
    return { status: "unmatched" };
  }

  const entry = await store.recordDepositCredit({
    userId: depositAddress.userId,
    amountUsd: transfer.amountUsd,
    chain: transfer.chain,
    txHash: transfer.txHash,
    logIndex: null,
    circleTransferId: transfer.transferId,
    metadata: {
      blockchain: transfer.blockchain,
      tokenId: transfer.tokenId,
      destinationAddress: transfer.destinationAddress,
    },
  });
  if (!entry) {
    return { status: "duplicate", userId: depositAddress.userId };
  }

  await store.audit({
    entityId: depositAddress.userId,
    entityType: "user",
    eventType: "deposit.credited",
    message: "USDC deposit credited.",
    data: { transfer, entryId: entry.entryId },
  });
  await jobQueue.enqueueSweepDeposit({
    userId: depositAddress.userId,
    circleTransferId: transfer.transferId,
    amountUsd: transfer.amountUsd,
    chain: transfer.chain,
  });
  return { status: "credited", userId: depositAddress.userId };
}

async function depositsPollCursor(store: CassieStore): Promise<string | undefined> {
  const state = await store.getRuntimeState<unknown>(DEPOSITS_POLL_CURSOR_KEY);
  if (isRecord(state) && typeof state.cursor === "string") return state.cursor;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
