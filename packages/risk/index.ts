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

  if (!input.userSettings.allowedVenues.includes(market.venue)) {
    return { decision: "reject", reason: "Venue is not enabled by the user." };
  }

  if (!input.userSettings.allowedAssets.includes(market.symbol)) {
    return { decision: "reject", reason: "Asset is not enabled by the user." };
  }

  if (market.spreadBps > input.userSettings.maxSpreadBps) {
    return { decision: "reject", reason: "Spread is wider than user limit." };
  }

  if (market.estimatedSlippageBps > input.userSettings.maxSlippageBps) {
    return { decision: "reject", reason: "Estimated slippage is wider than user limit." };
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

  if (input.accountState.dailyLossUsd >= input.userSettings.maxDailyLossUsd) {
    return { decision: "reject", reason: "Daily loss limit reached." };
  }

  if (input.accountState.openExposureUsd + adjustedSizeUsd > input.userSettings.maxPositionUsd) {
    return { decision: "reject", reason: "Position exposure limit would be exceeded." };
  }

  if (!input.userSettings.autoTradeEnabled) {
    return { decision: "require_approval", reason: "Auto-trade is disabled." };
  }

  return { decision: "approve", adjustedSizeUsd };
}
