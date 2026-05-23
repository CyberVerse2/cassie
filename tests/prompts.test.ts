import { describe, expect, it } from "vitest";
import { marketSelectionPrompt, singleStepTradeExpressionPrompt } from "../packages/prompts/index.ts";

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
    expect(prompt).toContain("First identify the instrument, asset, company, event, team, election, macro release");
    expect(prompt).toContain("Hyperliquid can express that target only when it exists as a real Hyperliquid spot");
    expect(prompt).toContain("Polymarket can express that target only when it exists as a real prediction market");
    expect(prompt).toContain("use only hyperliquid or polymarket");
    expect(prompt).toContain("compare them as competing trades");
    expect(prompt).toContain("A near-expiry mispriced BTC prediction market may be better than a BTC perp");
  });

  it("frames market selection as expected-value comparison across supported venues", () => {
    const prompt = marketSelectionPrompt({
      thesis: {
        claim: "BTC should rally into the catalyst.",
        direction: "bullish",
        mentionedAssets: ["BTC"],
        topics: ["BTC"],
        timeHorizon: "days",
        evidenceQuality: "medium",
        manipulationRisk: "medium",
        confidence: 0.7,
      },
      candidates: [],
    });

    expect(prompt).toContain("best market expression for making money");
    expect(prompt).toContain("Rank competing Hyperliquid and Polymarket candidates by expected value");
    expect(prompt).toContain("faster-expiring mispriced Polymarket contract can be better than a Hyperliquid perp");
    expect(prompt).toContain("highest expected-value expression after costs and timing");
  });
});
