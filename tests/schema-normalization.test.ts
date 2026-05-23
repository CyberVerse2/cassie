import { describe, expect, it } from "vitest";
import { TradeExpressionPlanSchema } from "../packages/core/schemas/index.ts";

describe("schema normalization", () => {
  it("accepts negative expected edge for no-trade candidates", () => {
    const plan = TradeExpressionPlanSchema.parse({
      signal: "ZEC to reach 3-5% of BTC market cap",
      coreInterpretation: "Signal analysis rejected the speculative ZEC/BTC pair thesis.",
      directAsset: "ZEC",
      directAssetTradable: true,
      highestPurityExpression: "Long ZEC / short BTC pair",
      publicMarketReadThrough: "none",
      candidates: [
        {
          instrument: "ZECBTC",
          venue: "crypto_spot",
          symbol: "ZECBTC",
          instrumentType: "spot",
          venueQuery: null,
          expression: "no_trade",
          thesis: "Long ZEC against BTC based on BTC holders rebalancing into ZEC.",
          venueChecks: [],
          currentMarketPriceOrOdds: "0.007",
          fairValueOrExpectedValue: "< 0.005",
          causalDirectness: 0.9,
          liquidity: 0.3,
          surprise: 0.1,
          timing: 0.1,
          crowdingRisk: 0.2,
          downsideAsymmetry: 0.1,
          evidenceQuality: 0.2,
          expectedEdge: -0.8,
          tradableNow: false,
          rejectionReason: "The pair has bad expected value.",
          invalidation: ["ZEC/BTC breaks structural resistance."],
          evidenceNeeded: ["Institutional custody adoption."],
        },
      ],
      decision: "no_trade",
      reason: "The trade thesis is structurally unviable.",
      marketRouterInstructions: null,
    });

    expect(plan.candidates[0]?.expectedEdge).toBe(-0.8);
  });
});
