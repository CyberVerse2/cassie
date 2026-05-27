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

  if (market.thesisFit < input.userSettings.minConfidence) {
    return {
      decision: "create_ticket_only",
      reason: "Thesis fit is below the auto-approval threshold.",
    };
  }

  const requestedSize = input.sizeUsd ?? input.userSettings.defaultTradeSizeUsd;
  const adjustedSizeUsd = Math.min(requestedSize, input.userSettings.maxTradeSizeUsd);

  if (adjustedSizeUsd < market.minOrderSizeUsd) {
    return { decision: "reject", reason: "Trade size is below venue minimum." };
  }

  if (adjustedSizeUsd > input.accountState.availableBalanceUsd) {
    return { decision: "reject", reason: "Insufficient available balance." };
  }

  return { decision: "approve", adjustedSizeUsd };
}
