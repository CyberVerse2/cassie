import {
  accountResponse,
  accountSyncSchema,
  apiError,
  authenticatedContext,
} from "../../_lib/account";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const body = accountSyncSchema.parse(await request.json());
    await store.syncPrivyUser({
      privyUserId: claims.user_id,
      privyWalletId: body.privyWalletId,
      walletAddress: body.walletAddress,
      profile: body.profile,
      defaultTradeSizeUsd: body.defaultTradeSizeUsd,
    });
    return accountResponse(claims.user_id, store);
  } catch (error) {
    return apiError(error);
  }
}
