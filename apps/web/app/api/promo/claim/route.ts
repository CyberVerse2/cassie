import { NextResponse } from "next/server";
import { CircleWalletAdapter } from "../../../../../../packages/adapters/circle";
import { invalidateDepositWalletBalance } from "../../../../../../packages/app/deposit-balance";
import { config } from "../../../../../../packages/core/config";
import {
  apiError,
  authenticatedContext,
  ensureDepositAddress,
} from "../../_lib/account";

export const runtime = "nodejs";

const PROMO_GRANT_USD = 10;

// One-time starter grant: sends $10 of treasury USDC to the user's deposit
// wallet so they can make real calls before depositing anything themselves.
// One grant per account, enforced by the promoGrant claim lock on settings.
export async function POST(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const settings = session.settings;
    if (!settings) {
      return NextResponse.json({ error: "Sign in to claim." }, { status: 401 });
    }
    if (settings.promoGrant) {
      return NextResponse.json(
        { error: "Your starter USDC has already been claimed." },
        { status: 409 },
      );
    }

    const depositAddress = await ensureDepositAddress(store, settings.userId);
    if (!depositAddress) {
      return NextResponse.json(
        { error: "Deposits are not available right now." },
        { status: 503 },
      );
    }

    // Lock the claim before moving money so a double-click can't double-send;
    // roll it back if the transfer fails so the user can retry.
    const chain = config.circle.defaultChain;
    const grant = {
      amountUsd: PROMO_GRANT_USD,
      transferId: null as string | null,
      chain,
      grantedAt: new Date().toISOString(),
    };
    await store.upsertUserSettings({ ...settings, promoGrant: grant });

    try {
      const transfer = await new CircleWalletAdapter().refundUserUsdcFromTreasury({
        userWalletAddress: depositAddress.evmAddress,
        amountUsd: PROMO_GRANT_USD,
        referenceId: `promo:${settings.userId}`,
        chain,
      });
      grant.transferId = transfer.transferId;
      await store.upsertUserSettings({ ...settings, promoGrant: grant });
      // The next balance read must see the grant, not the cached pre-grant
      // value.
      invalidateDepositWalletBalance(depositAddress.circleWalletId);
    } catch (error) {
      await store.upsertUserSettings({ ...settings, promoGrant: null });
      throw error;
    }

    await store.audit({
      entityId: settings.userId,
      entityType: "user",
      eventType: "wallet.promo_grant",
      message: `Starter USDC granted ($${PROMO_GRANT_USD}).`,
      data: { amountUsd: PROMO_GRANT_USD, chain, transferId: grant.transferId },
    });

    return NextResponse.json({
      grant: { amountUsd: PROMO_GRANT_USD, transferId: grant.transferId },
    });
  } catch (error) {
    return apiError(error);
  }
}
