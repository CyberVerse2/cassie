import { describe, expect, it } from "vitest";
import { tradeExpressionPrompt } from "../packages/prompts/index.ts";

describe("Cassie prompts", () => {
  it("keeps vague sector watchlists from becoming invented instruments", () => {
    const prompt = tradeExpressionPrompt({
      sourcePost: {
        text: "Banking strong if support holds. Pharma stable. Auto sentiment improving. IT pressured.",
      },
      signal: {
        signalType: "generic_opinion",
        directTradability: "none",
        leadQuality: "ignore",
      },
    });

    expect(prompt).toContain("For vague sector watchlists");
    expect(prompt).toContain("Set directAsset to null");
    expect(prompt).toContain("Do not invent a representative index, ETF, stock, token, or option");
    expect(prompt).toContain("No concrete instrument");
  });
});
