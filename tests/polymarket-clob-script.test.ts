import { describe, expect, it } from "vitest";
import {
  parsePolymarketSmokeArgs,
  parsePriceArray,
  parseStringArray,
  selectOutcomeToken,
} from "../scripts/test-polymarket-clob.ts";

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

  it("rejects malformed market arrays instead of hiding them", () => {
    expect(() => parseStringArray("not-json", "outcomes")).toThrow("must be a JSON array");
    expect(() => parseStringArray("[\"Yes\", 1]", "outcomes")).toThrow("outcomes[1] must be a string");
    expect(parseStringArray("[\"Yes\", null, \"No\"]", "outcomes")).toEqual(["Yes", "No"]);
  });

  it("parses numeric market prices without dropping invalid values", () => {
    expect(parsePriceArray("[0.62, \"0.38\", null]", "outcomePrices")).toEqual([0.62, 0.38]);
    expect(() => parsePriceArray("[\"bad\"]", "outcomePrices")).toThrow("outcomePrices[0] must be numeric");
  });
});
