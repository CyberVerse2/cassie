import { InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import type { AccountState, UserSettings } from "../../core/schemas/index.ts";
import { MissingConnectorConfigError } from "../../core/helpers/connector-errors.ts";

export interface AccountStateProvider {
  getAccountState(userSettings: UserSettings): Promise<AccountState>;
}

type HyperliquidInfoClient = Pick<
  InfoClient,
  "clearinghouseState" | "spotClearinghouseState" | "userAbstraction" | "userRole"
>;

const USDC_TOKEN_ID = 0;
const UNIFIED_COLLATERAL_MODES = new Set(["unifiedAccount", "portfolioMargin"]);

export class HyperliquidAccountStateProvider implements AccountStateProvider {
  constructor(private readonly info: HyperliquidInfoClient = new InfoClient({ transport: new HttpTransport() })) {}

  async getAccountState(userSettings: UserSettings): Promise<AccountState> {
    if (!userSettings.walletAddress) {
      throw new MissingConnectorConfigError("Account state", "userSettings.walletAddress");
    }

    const accountAddress = await resolveHyperliquidAccountAddress(
      this.info,
      userSettings.walletAddress as `0x${string}`,
    );
    const [state, abstraction] = await Promise.all([
      this.info.clearinghouseState({ user: accountAddress }),
      this.info.userAbstraction({ user: accountAddress }),
    ]);
    const marginSummary = state.marginSummary as {
      accountValue?: string;
      totalNtlPos?: string;
    };
    const assetPositions = Array.isArray(state.assetPositions) ? state.assetPositions : [];
    const openExposureUsd = readHyperliquidNumber(marginSummary.totalNtlPos, "total notional position");
    const availableBalanceUsd = UNIFIED_COLLATERAL_MODES.has(abstraction)
      ? await this.getUnifiedUsdcBalance(accountAddress)
      : readHyperliquidNumber(marginSummary.accountValue, "perps account value");
    const unrealizedLoss = assetPositions.reduce((total, position) => {
      const pnl = readHyperliquidNumber(position.position?.unrealizedPnl, "unrealized PNL");
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

  private async getUnifiedUsdcBalance(accountAddress: `0x${string}`): Promise<number> {
    const state = await this.info.spotClearinghouseState({ user: accountAddress });
    const usdcBalance = state.balances.find((balance) =>
      balance.token === USDC_TOKEN_ID || balance.coin.toUpperCase() === "USDC"
    );
    if (!usdcBalance) return 0;

    const total = readHyperliquidNumber(usdcBalance.total, "spot USDC total balance");
    const hold = readHyperliquidNumber(usdcBalance.hold, "spot USDC held balance");
    return Math.max(0, total - hold);
  }
}

async function resolveHyperliquidAccountAddress(
  info: HyperliquidInfoClient,
  address: `0x${string}`,
): Promise<`0x${string}`> {
  const role = await info.userRole({ user: address });
  if (role.role === "agent") {
    return role.data.user;
  }
  if (role.role === "subAccount") {
    return address;
  }
  return address;
}

function readHyperliquidNumber(value: string | number | undefined, label: string): number {
  if (value == null) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Hyperliquid ${label}: ${value}`);
  }
  return parsed;
}
