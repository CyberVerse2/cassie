import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest, type AuthenticatedSession } from "../../../../../packages/adapters/auth/session";
import { CircleWalletAdapter } from "../../../../../packages/adapters/circle";
import { PrivyAdapter } from "../../../../../packages/adapters/privy";
import { DrizzleCassieStore } from "../../../../../packages/core/db/drizzle-store";
import type { CassieStore } from "../../../../../packages/core/db/store";
import { MissingConnectorConfigError } from "../../../../../packages/core/helpers/connector-errors";
import { shouldPromptPrivyMigration } from "../../../../../packages/app/privy-migration";
import { UserProfileSchema, type UserDepositAddress, type UserSettings } from "../../../../../packages/core/schemas";

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

export type { AuthenticatedSession };

export async function authenticatedContext(request: Request) {
  const store = new DrizzleCassieStore();
  const session = await authenticateRequest(request, { store });
  return {
    session,
    store,
  };
}

export async function accountResponse(
  settings: UserSettings | null | undefined,
  store = new DrizzleCassieStore(),
  walletGateway = new PrivyAdapter(),
) {
  if (!settings) {
    return NextResponse.json({ account: null }, { status: 404 });
  }

  const depositAddress = await ensureDepositAddress(store, settings.userId);
  const walletBalanceUsd = settings.privyWalletId
    ? await walletGateway.getUsdcBalanceUsd({ walletId: settings.privyWalletId })
    : null;
  const balance = walletBalanceUsd != null
    ? await store.getWalletFundingBalance(settings.userId, walletBalanceUsd)
    : depositAddress
      ? await store.getDepositFundingBalance(settings.userId)
      : null;
  return NextResponse.json({
    account: {
      userId: settings.userId,
      privyUserId: settings.privyUserId,
      privyWalletId: settings.privyWalletId,
      walletAddress: settings.walletAddress,
      depositAddress: depositAddress?.evmAddress ?? null,
      profile: settings.profile,
      x: settings.x ?? null,
      defaultTradeSizeUsd: settings.defaultTradeSizeUsd,
      telegram: settings.telegram ?? null,
      balance: balance ?? null,
      migration: settings.migration ?? null,
      migrationPrompt: shouldPromptPrivyMigration({
        settings,
        privyBalanceUsd: walletBalanceUsd,
        hasDepositAddress: Boolean(depositAddress),
      }),
    },
  });
}

export async function ensureDepositAddress(
  store: CassieStore,
  userId: string,
): Promise<UserDepositAddress | undefined> {
  const existing = await store.getDepositAddress(userId);
  if (existing) return existing;
  try {
    const circle = new CircleWalletAdapter();
    const provisioned = await circle.provisionDepositAddress(userId);
    return await store.addUserDepositAddress({
      userId,
      walletSetId: provisioned.walletSetId,
      circleWalletId: provisioned.circleWalletId,
      evmAddress: provisioned.evmAddress,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // Circle not configured yet (Privy-only deployment): the account payload
    // simply omits the deposit address.
    if (error instanceof MissingConnectorConfigError) return undefined;
    throw error;
  }
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
