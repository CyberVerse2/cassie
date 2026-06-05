import { describe, expect, it } from "vitest";
import { createTradeTicket, MIN_HYPERLIQUID_PERP_MARGIN_USD } from "../packages/tickets/index.ts";
import type { MarketSelection, Thesis, TradeExitPlan, UserSettings } from "../packages/core/schemas/index.ts";

const userSettings: UserSettings = {
  userId: "user_1",
  privyUserId: "did:privy:user_1",
  privyWalletId: "wallet_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
  defaultTradeSizeUsd: 2,
};

const thesis: Thesis = {
  claim: "SOL momentum is tradable.",
  direction: "bullish",
  mentionedAssets: ["SOL"],
  topics: ["solana"],
  timeHorizon: "days",
  evidenceQuality: "medium",
  manipulationRisk: "medium",
  confidence: 0.72,
};

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "SOL momentum is tradable.",
  invalidationSignals: ["SOL momentum breaks down."],
};

const hyperliquidSelection: MarketSelection = {
  decision: "select_market",
  selectedCandidateId: "hyperliquid:SOL:long",
  selectedMarket: {
    venue: "hyperliquid",
    instrument: "perp",
    side: "long",
    symbol: "SOL",
    conditionId: null,
    outcomeTokenId: null,
    yesOutcomeTokenId: null,
    noOutcomeTokenId: null,
    marketQuestion: null,
    marketSlug: null,
    outcome: null,
    yesPrice: null,
    noPrice: null,
    heldSidePrice: null,
    volumeUsd: 1_000_000,
    liquidityUsd: 1_000_000,
    endDate: null,
    warnings: [],
    markPrice: 100,
    liquidityScore: 0.9,
    spreadBps: 5,
    estimatedSlippageBps: 10,
    minOrderSizeUsd: 10,
    thesisFit: 0.95,
    reason: "Direct SOL perp.",
  },
  rejectionReason: null,
  rankedCandidates: [],
  rejectedCandidates: [],
  noTradeReason: null,
};

describe("createTradeTicket", () => {
  it("rejects Hyperliquid perp tickets below the user-visible minimum", () => {
    expect(() => createTradeTicket({
      runId: "run_1",
      userSettings,
      thesis,
      marketSelection: hyperliquidSelection,
      exitPlan,
    })).toThrow(`below Hyperliquid's $${MIN_HYPERLIQUID_PERP_MARGIN_USD} minimum`);
  });
});
