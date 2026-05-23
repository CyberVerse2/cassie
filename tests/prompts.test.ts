import { describe, expect, it } from "vitest";
import { singleStepTradeExpressionPrompt } from "../packages/prompts/index.ts";

describe("Cassie prompts", () => {
  it("keeps vague sector watchlists from becoming invented instruments", () => {
    const prompt = singleStepTradeExpressionPrompt({
      sourcePost: {
        platform: "x",
        postId: null,
        url: null,
        authorHandle: null,
        authorName: null,
        text: "Banking strong if support holds. Pharma stable. Auto sentiment improving. IT pressured.",
        createdAt: null,
      },
      userCommand: "@Cassie should we trade this?",
    });

    expect(prompt).toContain("Do not invent venue availability");
    expect(prompt).toContain("If no real market candidate is known yet, use needs_market_check");
    expect(prompt).toContain("Use no_trade when the cleanest expression is unavailable");
  });
});
