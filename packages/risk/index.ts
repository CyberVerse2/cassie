import type {
  AccountState,
  MarketSelection,
  RiskDecision,
  UserSettings,
} from "../core/schemas/index.ts";

export function evaluateRisk(input: {
  marketSelection: MarketSelection;
  userSettings: UserSettings;
  accountState: AccountState;
}): RiskDecision {
  const market = input.marketSelection.selectedMarket;

  if (!market) {
    return {
      decision: "reject",
      reason: input.marketSelection.noTradeReason ?? "No market selected.",
    };
  }

  const adjustedSizeUsd = input.userSettings.defaultTradeSizeUsd;

  if (adjustedSizeUsd > input.accountState.availableBalanceUsd) {
    return { decision: "reject", reason: "Insufficient available balance." };
  }

  return { decision: "approve", adjustedSizeUsd };
}
