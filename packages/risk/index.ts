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
  sizeUsd?: number | null;
}): RiskDecision {
  const market = input.marketSelection.selectedMarket;

  if (!market) {
    return {
      decision: "reject",
      reason: input.marketSelection.noTradeReason ?? "No market selected.",
    };
  }

  const requestedSize = input.sizeUsd ?? input.userSettings.defaultTradeSizeUsd;
  const adjustedSizeUsd = Math.min(requestedSize, input.userSettings.maxTradeSizeUsd);

  if (adjustedSizeUsd > input.accountState.availableBalanceUsd) {
    return { decision: "reject", reason: "Insufficient available balance." };
  }

  return { decision: "approve", adjustedSizeUsd };
}
