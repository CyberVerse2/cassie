import { NextResponse } from "next/server";
import { z } from "zod";
import { PrivyAdapter } from "../../../../../packages/adapters/privy";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";
import { queueWithdrawal } from "../../../../../packages/withdrawals";

export const runtime = "nodejs";

const WithdrawalRequestSchema = z.object({
  amountUsd: z.number().positive(),
  destinationAddress: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }
    return NextResponse.json({
      withdrawals: await store.listUserWithdrawals(settings.userId),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = WithdrawalRequestSchema.parse(await request.json());
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }
    if (!settings.privyWalletId) {
      return NextResponse.json({ error: "A signer-provisioned wallet is required before withdrawal." }, { status: 400 });
    }
    const walletGateway = new PrivyAdapter();
    const walletBalanceUsd = await walletGateway.getUsdcBalanceUsd(settings.privyWalletId);
    const withdrawal = await queueWithdrawal({
      userId: settings.userId,
      amountUsd: body.amountUsd,
      destinationAddress: body.destinationAddress,
      walletBalanceUsd,
      store,
    });
    return NextResponse.json({ withdrawal });
  } catch (error) {
    return apiError(error);
  }
}
