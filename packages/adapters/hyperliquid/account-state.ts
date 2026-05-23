import { InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import type { AccountState, UserSettings } from "../../core/schemas/index.ts";
import { MissingConnectorConfigError } from "../../core/helpers/index.ts";

export interface AccountStateProvider {
  getAccountState(userSettings: UserSettings): Promise<AccountState>;
}

export class HyperliquidAccountStateProvider implements AccountStateProvider {
  async getAccountState(userSettings: UserSettings): Promise<AccountState> {
    if (!userSettings.walletAddress) {
      throw new MissingConnectorConfigError("Account state", "userSettings.walletAddress");
    }

    const info = new InfoClient({ transport: new HttpTransport() });
    const state = await info.clearinghouseState({ user: userSettings.walletAddress as `0x${string}` });
    const marginSummary = state.marginSummary as {
      accountValue?: string;
      totalNtlPos?: string;
    };
    const assetPositions = Array.isArray(state.assetPositions) ? state.assetPositions : [];
    const openExposureUsd = Number(marginSummary.totalNtlPos ?? 0);
    const availableBalanceUsd = Number(marginSummary.accountValue ?? 0);
    const unrealizedLoss = assetPositions.reduce((total, position) => {
      const pnl = Number(position.position?.unrealizedPnl ?? 0);
      return pnl < 0 ? total + Math.abs(pnl) : total;
    }, 0);

    return {
      userId: userSettings.userId,
      availableBalanceUsd,
      openExposureUsd,
      dailyLossUsd: unrealizedLoss,
      openOrdersUsd: 0,
    };
  }
}
