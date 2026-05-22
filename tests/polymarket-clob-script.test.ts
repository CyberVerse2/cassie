import { describe, expect, it } from "vitest";
import { parsePolymarketSmokeArgs, selectOutcomeToken } from "../scripts/test-polymarket-clob.ts";

describe("test-polymarket-clob script helpers", () => {
  it("defaults to a dry-run bullish YES smoke query", () => {
    expect(parsePolymarketSmokeArgs(["--query", "Solana ETF"])).toEqual({
      query: "Solana ETF",
      outcome: "yes",
      sizeUsd: 1,
      limit: 10,
      marketIndex: null,
      marketSlug: null,
      conditionId: null,
      execute: false,
    });
  });

  it("selects the requested YES or NO outcome token", () => {
    const market = {
      question: "Will a Solana ETF be approved?",
      slug: "solana-etf-approved",
      conditionId: "condition",
      outcomes: ["Yes", "No"],
      tokenIds: ["yes-token", "no-token"],
      prices: [0.62, 0.38],
      liquidityUsd: 100000,
      volumeUsd: 200000,
      endDate: "2026-12-31T00:00:00Z",
    };

    expect(selectOutcomeToken(market, "yes")).toBe("yes-token");
    expect(selectOutcomeToken(market, "no")).toBe("no-token");
  });
});
