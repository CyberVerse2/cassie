import { CircleWalletAdapter } from "../adapters/circle/index.ts";
import { MissingConnectorConfigError } from "../core/helpers/connector-errors.ts";
import type { UserDepositAddress } from "../core/schemas/index.ts";

// Balances are physical: the user's USDC sits in their Circle deposit wallet
// and moves to/from the treasury as trades open and close. Returns null when
// Circle is not configured in this deployment.
export async function depositWalletBalanceUsd(
  depositAddress: UserDepositAddress,
): Promise<number | null> {
  try {
    const circle = new CircleWalletAdapter();
    return await circle.getUsdcBalanceUsd({ walletId: depositAddress.circleWalletId });
  } catch (error) {
    if (error instanceof MissingConnectorConfigError) return null;
    throw error;
  }
}
