import { randomUUID } from "node:crypto";
import type {
  MarketSelection,
  RiskDecision,
  Thesis,
  TradeTicket,
  UserSettings,
} from "../core/schemas/index.ts";

export function createTradeTicket(input: {
  runId?: string | null;
  userSettings: UserSettings;
  thesis: Thesis;
  marketSelection: MarketSelection;
  riskDecision: RiskDecision;
}): TradeTicket {
  const market = input.marketSelection.selectedMarket;

  if (!market) {
    throw new Error("Cannot create a trade ticket without a selected market.");
  }

  if (input.riskDecision.decision !== "approve") {
    throw new Error(`Cannot create trade ticket without approved risk: ${input.riskDecision.reason}`);
  }

  return {
    ticketId: randomUUID(),
    runId: input.runId ?? null,
    userId: input.userSettings.userId,
    thesis: input.thesis.claim,
    venue: market.venue,
    instrument: market.instrument,
    side: market.side,
    sizeUsd: input.riskDecision.adjustedSizeUsd,
    orderType: "marketable_limit",
    venueData: {
      symbol: market.symbol,
      conditionId: market.conditionId ?? null,
      outcomeTokenId: market.outcomeTokenId ?? null,
      markPrice: market.markPrice ?? null,
      spreadBps: market.spreadBps,
      estimatedSlippageBps: market.estimatedSlippageBps,
      minOrderSizeUsd: market.minOrderSizeUsd,
    },
    riskDecision: input.riskDecision,
  };
}
