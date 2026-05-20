import type {
  MarketSelection,
  RiskDecision,
  UserSettings,
} from "../schemas.js";

export function evaluateRisk(input: {
  marketSelection: MarketSelection;
  userSettings: UserSettings;
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

  if (market.thesisFit < input.userSettings.minConfidence) {
    return {
      decision: "create_ticket_only",
      reason: "Thesis fit is below the auto-approval threshold.",
    };
  }

  const requestedSize = input.sizeUsd ?? input.userSettings.defaultTradeSizeUsd;
  const adjustedSizeUsd = Math.min(requestedSize, input.userSettings.maxTradeSizeUsd);

  if (!input.userSettings.autoTradeEnabled) {
    return { decision: "require_approval", reason: "Auto-trade is disabled." };
  }

  return { decision: "approve", adjustedSizeUsd };
}
