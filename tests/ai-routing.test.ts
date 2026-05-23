import { describe, expect, it } from "vitest";
import {
  DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS,
  IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS,
  CassieStructuredClient,
  MissingAiDependencyError,
  routeStructuredModel,
} from "../packages/ai/client.ts";

describe("structured AI model routing", () => {
  it("routes lightweight ranking steps to direct DeepSeek", () => {
    expect(routeStructuredModel({ name: "cassie_market_selection" })).toMatchObject({
      provider: "deepseek",
      tier: "cheap",
      model: "deepseek-v4-flash",
    });
  });

  it("routes judgment steps to DeepSeek v4 Pro", () => {
    expect(routeStructuredModel({ name: "cassie_trade_expressions" })).toMatchObject({
      provider: "deepseek",
      tier: "expensive",
      model: "deepseek-v4-pro",
    });
  });

  it("allows explicit tier overrides for structured calls", () => {
    expect(routeStructuredModel({ name: "custom_low_risk_step", tier: "cheap" })).toMatchObject({
      provider: "deepseek",
      tier: "cheap",
    });
    expect(routeStructuredModel({ name: "cassie_market_selection", tier: "expensive" })).toMatchObject({
      provider: "deepseek",
      tier: "expensive",
    });
  });

  it("surfaces missing DeepSeek key for cheap semantic work", async () => {
    const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    await expect(
      new CassieStructuredClient().generateObject({
        schema: {} as never,
        name: "cassie_market_selection",
        prompt: "test",
      }),
    ).rejects.toBeInstanceOf(MissingAiDependencyError);

    if (originalDeepSeekKey) {
      process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    }
  });

  it("keeps direct provider generation ceilings below huge provider defaults", () => {
    expect(DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(8_192);
    expect(IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(32_768);
  });
});
