import { randomUUID } from "node:crypto";
import type {
  MarketSelection,
  Thesis,
  TradeTicket,
  UserSettings,
} from "../core/schemas/index.ts";

export function createTradeTicket(input: {
  runId?: string | null;
  userSettings: UserSettings;
  thesis: Thesis;
  marketSelection: MarketSelection;
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
    exitPlan: {
      takeProfitPct: 10,
      stopLossPct: 5,
      maxHoldDays: 7,
      reviewCadence: "daily",
      thesis: input.thesis.claim,
      invalidationSignals: input.thesis.shouldNotInferTradeBecause?.length
        ? input.thesis.shouldNotInferTradeBecause
        : [
            ...input.thesis.mentionedAssets.map((asset) => `${asset} no longer matches the trade thesis.`),
            `${input.thesis.claim} is contradicted by fresh market evidence.`,
          ],
    },
  };
}
