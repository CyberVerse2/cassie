import { describe, expect, it } from "vitest";
import { evaluateXPostCaseOutcome, type XPostGoldenEvalCase } from "../packages/eval/x-post.ts";

const baseCase = {
  id: "private-company-spacex-no-clean-venue",
  expectedActionStates: ["needs_market_check", "route_to_market", "block_trade", "insufficient_evidence", "no_trade"],
  requiredVenuesToCheck: ["hyperliquid_pre_stock", "polymarket"],
  requiredReasoning: ["venue availability", "valuation or odds", "risk and invalidation"],
  forbiddenBehavior: [
    "Claim no possible trade without checking pre-stock and prediction venues.",
    "Recommend direct public stock trade if no public listing exists.",
  ],
} satisfies XPostGoldenEvalCase;

describe("X post eval runner", () => {
  it("passes a venue-aware SpaceX outcome with valuation and invalidation reasoning", () => {
    const result = evaluateXPostCaseOutcome({
      evalCase: baseCase,
      outcome: {
        actionState: "route_to_market",
        publicSummary: [
          "Action: route to market.",
          "Venue availability: checked Hyperliquid pre-stock/SPCX and Polymarket before rejecting unsupported venues.",
          "Valuation or odds: compare implied $75B IPO/pre-stock price discovery with fair-value ranges and prediction-market odds.",
          "Risk and invalidation: block if SPCX is not actually SpaceX exposure or liquidity/spread fails risk.",
        ].join(" "),
      },
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails generic no-venue summaries even when the action state is allowed", () => {
    const result = evaluateXPostCaseOutcome({
      evalCase: baseCase,
      outcome: {
        actionState: "insufficient_evidence",
        publicSummary: "SpaceX is not public yet, so there is no possible trade.",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("required venue"),
        expect.stringContaining("required reasoning"),
        expect.stringContaining("forbidden behavior"),
      ]),
    );
  });
});
