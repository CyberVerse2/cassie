import { randomUUID } from "node:crypto";
import { DEFAULT_HYPERLIQUID_PERP_LEVERAGE } from "../core/config.ts";
import type {
  MarketSelection,
  Thesis,
  TradeExitPlan,
  TradeTicket,
  UserSettings,
} from "../core/schemas/index.ts";

export const MIN_HYPERLIQUID_PERP_MARGIN_USD = 6;

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
  const isHyperliquidPerp = market.venue === "hyperliquid" && (market.side === "long" || market.side === "short");
  const sizeUsd = isHyperliquidPerp
    ? Math.max(input.userSettings.defaultTradeSizeUsd, MIN_HYPERLIQUID_PERP_MARGIN_USD)
    : input.userSettings.defaultTradeSizeUsd;
  const leverage = isHyperliquidPerp ? DEFAULT_HYPERLIQUID_PERP_LEVERAGE : undefined;

  return {
    ticketId: randomUUID(),
    runId: input.runId ?? null,
    userId: input.userSettings.userId,
    thesis: input.thesis.claim,
    venue: market.venue,
    instrument: market.instrument,
    side: market.side,
    sizeUsd,
    orderType: "marketable_limit",
    venueData: {
      symbol: market.symbol,
      conditionId: market.conditionId ?? null,
      outcomeTokenId: market.outcomeTokenId ?? null,
      markPrice: market.markPrice ?? null,
      spreadBps: market.spreadBps,
      estimatedSlippageBps: market.estimatedSlippageBps,
      minOrderSizeUsd: market.minOrderSizeUsd,
      leverage,
      notionalSizeUsd: leverage ? sizeUsd * leverage : undefined,
    },
    exitPlan: input.exitPlan,
  };
}
