import { describe, expect, it } from "vitest";
import { evaluateRisk } from "../packages/risk/index.ts";
import { UserSettingsSchema, type MarketSelection, type UserSettings } from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "user_1",
  walletAddress: "0x0000000000000000000000000000000000000000",
  defaultTradeSizeUsd: 50,
};

const marketSelection: MarketSelection = {
  decision: "select_market",
  selectedMarket: {
    venue: "polymarket",
    instrument: "solana-etf-approved",
    side: "buy_yes",
    symbol: "solana-etf-approved",
    conditionId: "condition_1",
    outcomeTokenId: "token_yes",
    yesOutcomeTokenId: "token_yes",
    noOutcomeTokenId: "token_no",
    marketQuestion: "Will a Solana ETF be approved?",
    marketSlug: "solana-etf-approved",
    outcome: "yes",
    yesPrice: 0.58,
    noPrice: 0.42,
    heldSidePrice: 0.58,
    volumeUsd: 100_000,
    liquidityUsd: 25_000,
    endDate: null,
    warnings: [],
    markPrice: 0.58,
    liquidityScore: 0.9,
    spreadBps: 2_500,
    estimatedSlippageBps: 2_500,
    minOrderSizeUsd: 10,
    thesisFit: 0.9,
    reason: "Direct prediction market.",
  },
  selectedCandidateId: "polymarket|solana-etf-approved|buy_yes",
  rejectionReason: null,
  rankedCandidates: [],
  rejectedCandidates: [],
  noTradeReason: null,
};

describe("risk evaluation", () => {
  it("does not block trades on stale policy settings", () => {
    expect(evaluateRisk({
      marketSelection,
      userSettings: settings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 1_000,
        dailyLossUsd: 100,
        openOrdersUsd: 0,
      },
    })).toEqual({
      decision: "approve",
      adjustedSizeUsd: 50,
    });
  });

  it("parses only the app settings needed for trading", () => {
    const parsed = UserSettingsSchema.parse({
      userId: "user_1",
      walletAddress: null,
      defaultTradeSizeUsd: 50,
    });

    expect(parsed).toEqual({
      userId: "user_1",
      walletAddress: null,
      defaultTradeSizeUsd: 50,
    });
    expect(parsed).not.toHaveProperty("allowedVenues");
    expect(parsed).not.toHaveProperty("maxTradeSizeUsd");
  });

  it("does not block trades below venue minimum or low thesis fit", () => {
    expect(evaluateRisk({
      marketSelection: {
        ...marketSelection,
        selectedMarket: {
          ...marketSelection.selectedMarket!,
          thesisFit: 0.2,
          minOrderSizeUsd: 1_000,
        },
      },
      userSettings: settings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
    })).toEqual({
      decision: "approve",
      adjustedSizeUsd: 50,
    });
  });

  it("uses the configured default trade size exactly", () => {
    expect(evaluateRisk({
      marketSelection,
      userSettings: {
        ...settings,
        defaultTradeSizeUsd: 150,
      },
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
    })).toEqual({
      decision: "approve",
      adjustedSizeUsd: 150,
    });
  });
});
