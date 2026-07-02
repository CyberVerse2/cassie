import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { PrivyAdapter } from "../../../../../packages/adapters/privy";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

const withdrawSchema = z.object({
  toAddress: z.string().min(1),
});

// Sends the full USDC balance of the user's legacy Privy wallet to an
// address of their choosing, via the delegated server-side signer.
export async function POST(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const body = withdrawSchema.parse(await request.json());
    const settings = session.settings;
    if (!settings?.privyWalletId) {
      return NextResponse.json({ error: "No legacy wallet to withdraw from." }, { status: 400 });
    }
    if (!isAddress(body.toAddress)) {
      return NextResponse.json({ error: "That does not look like a valid address." }, { status: 400 });
    }

    const privy = new PrivyAdapter();
    const balanceUsd = await privy.getUsdcBalanceUsd({ walletId: settings.privyWalletId });
    if (balanceUsd <= 0) {
      return NextResponse.json({ error: "There is no USDC left to withdraw." }, { status: 400 });
    }

    const transfer = await privy.transferUserUsdc({
      userWalletId: settings.privyWalletId,
      toAddress: body.toAddress,
      amountUsd: balanceUsd,
      referenceId: `withdraw:${randomUUID()}`,
    });
    if (transfer.status !== "succeeded") {
      throw new Error(`Withdrawal ${transfer.transferId} did not confirm: ${transfer.status}.`);
    }

    await store.audit({
      entityId: settings.userId,
      entityType: "user",
      eventType: "wallet.withdrawal",
      message: "Legacy wallet USDC withdrawn.",
      data: { toAddress: body.toAddress, amountUsd: balanceUsd, transferId: transfer.transferId },
    });

    return NextResponse.json({
      withdrawal: {
        amountUsd: balanceUsd,
        toAddress: body.toAddress,
        transferId: transfer.transferId,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
