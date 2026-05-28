import { NextResponse } from "next/server";
import {
  accountSyncSchema,
  apiError,
  authenticatedContext,
} from "../../_lib/account";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const body = accountSyncSchema.parse(await request.json());
    const settings = await store.syncPrivyUser({
      privyUserId: claims.user_id,
      privyWalletId: body.privyWalletId,
      walletAddress: body.walletAddress,
      defaultTradeSizeUsd: body.defaultTradeSizeUsd,
    });
    const balance = await store.getCustodyBalance(settings.userId);

    return NextResponse.json({
      account: {
        userId: settings.userId,
        privyUserId: settings.privyUserId,
        privyWalletId: settings.privyWalletId,
        walletAddress: settings.walletAddress,
        defaultTradeSizeUsd: settings.defaultTradeSizeUsd,
        balance: balance ?? null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
