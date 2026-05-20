import { randomUUID } from "node:crypto";
import type {
  MarketSelection,
  RiskDecision,
  Thesis,
  TradeTicket,
  UserSettings,
} from "../schemas.js";

export function createTradeTicket(input: {
  userSettings: UserSettings;
  thesis: Thesis;
  marketSelection: MarketSelection;
  riskDecision: RiskDecision;
  sizeUsd?: number | null;
}): TradeTicket {
  const market = input.marketSelection.selectedMarket;

  if (!market) {
    throw new Error("Cannot create a trade ticket without a selected market.");
  }

  if (input.riskDecision.decision === "reject") {
    throw new Error(`Cannot create rejected trade ticket: ${input.riskDecision.reason}`);
  }

  const sizeUsd =
    input.riskDecision.decision === "approve"
      ? input.riskDecision.adjustedSizeUsd
      : Math.min(
          input.sizeUsd ?? input.userSettings.defaultTradeSizeUsd,
          input.userSettings.maxTradeSizeUsd,
        );

  return {
    ticketId: randomUUID(),
    userId: input.userSettings.userId,
    thesis: input.thesis.claim,
    venue: market.venue,
    instrument: market.instrument,
    side: market.side,
    sizeUsd,
    orderType: "marketable_limit",
    riskDecision: input.riskDecision,
    approvalState:
      input.riskDecision.decision === "approve" ? "not_required" : "pending",
  };
}
