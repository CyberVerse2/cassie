import {
  accountResponse,
  accountSyncSchema,
  apiError,
  authenticatedContext,
} from "../../_lib/account";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const body = accountSyncSchema.parse(await request.json());
    if (session.method === "privy_bearer") {
      const synced = await store.syncPrivyUser({
        privyUserId: session.privyUserId!,
        privyWalletId: body.privyWalletId,
        walletAddress: body.walletAddress,
        profile: body.profile,
        x: body.x ?? null,
        defaultTradeSizeUsd: body.defaultTradeSizeUsd,
      });
      return accountResponse(synced, store);
    }
    // Cookie sessions are synced during authentication; apply optional updates.
    let settings = session.settings!;
    if (body.defaultTradeSizeUsd != null) {
      settings = { ...settings, defaultTradeSizeUsd: body.defaultTradeSizeUsd };
      await store.upsertUserSettings(settings);
    }
    return accountResponse(settings, store);
  } catch (error) {
    return apiError(error);
  }
}
