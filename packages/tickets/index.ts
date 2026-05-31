import { randomUUID } from "node:crypto";
import type {
  MarketSelection,
  Thesis,
  TradeExitPlan,
  TradeTicket,
  UserSettings,
} from "../core/schemas/index.ts";

export function createTradeTicket(input: {
  runId?: string | null;
  userSettings: UserSettings;
  thesis: Thesis;
  marketSelection: MarketSelection;
  exitPlan: TradeExitPlan;
}): TradeTicket {
  const market = input.marketSelection.selectedMarket;

  if (!market) {
    throw new Error("Cannot create a trade ticket without a selected market.");
  }

  return {
    ticketId: randomUUID(),
    runId: input.runId ?? null,
    userId: input.userSettings.userId,
    thesis: input.thesis.claim,
    venue: market.venue,
    instrument: market.instrument,
    side: market.side,
    sizeUsd: input.userSettings.defaultTradeSizeUsd,
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
    exitPlan: input.exitPlan,
  };
}
