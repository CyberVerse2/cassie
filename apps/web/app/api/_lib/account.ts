import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePrivyRequest, PrivyAdapter } from "../../../../../packages/adapters/privy";
import { DrizzleCassieStore } from "../../../../../packages/core/db/drizzle-store";
import { UserProfileSchema } from "../../../../../packages/core/schemas";

export const MIN_DEFAULT_TRADE_SIZE_USD = 6;
export const MIN_DEFAULT_TRADE_SIZE_MESSAGE = `Default trade size must be at least $${MIN_DEFAULT_TRADE_SIZE_USD}.`;

export const accountSyncSchema = z.object({
  walletAddress: z.string().min(1).nullable(),
  privyWalletId: z.string().min(1).nullable(),
  profile: UserProfileSchema,
  x: z.object({
    userId: z.string().min(1).nullable(),
    username: z.string().min(1).nullable(),
  }).nullable().optional(),
  defaultTradeSizeUsd: z.number().min(MIN_DEFAULT_TRADE_SIZE_USD, MIN_DEFAULT_TRADE_SIZE_MESSAGE).optional(),
});

export async function authenticatedContext(request: Request) {
  const claims = await authenticatePrivyRequest(request);
  return {
    claims,
    store: new DrizzleCassieStore(),
  };
}

export async function accountResponse(
  privyUserId: string,
  store = new DrizzleCassieStore(),
  walletGateway = new PrivyAdapter(),
) {
  const settings = await store.getUserSettingsByPrivyUserId(privyUserId);
  if (!settings) {
    return NextResponse.json({ account: null }, { status: 404 });
  }

  const walletBalanceUsd = settings.privyWalletId
    ? await walletGateway.getUsdcBalanceUsd(settings.privyWalletId)
    : null;
  const balance = walletBalanceUsd == null
    ? null
    : await store.getWalletFundingBalance(settings.userId, walletBalanceUsd);
  return NextResponse.json({
    account: {
      userId: settings.userId,
      privyUserId: settings.privyUserId,
      privyWalletId: settings.privyWalletId,
      walletAddress: settings.walletAddress,
      profile: settings.profile,
      x: settings.x ?? null,
      defaultTradeSizeUsd: settings.defaultTradeSizeUsd,
      telegram: settings.telegram ?? null,
      balance: balance ?? null,
    },
  });
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isAuthenticationError(message)) {
    return NextResponse.json({ error: "Session expired. Log in again." }, { status: 401 });
  }
  return NextResponse.json({ error: message }, { status: 400 });
}

function isAuthenticationError(message: string) {
  return message === "Missing Privy access token."
    || message === "Failed to verify authentication token";
}
