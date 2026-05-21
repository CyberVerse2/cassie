import { describe, expect, it } from "vitest";
import {
  DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS,
  MissingAiDependencyError,
  OpenAiStructuredClient,
  routeStructuredModel,
} from "../packages/ai/client.ts";
import {
  GEMINI_SEARCH_MAX_OUTPUT_TOKENS,
  GeminiWebSearchLane,
  GrokXSearchLane,
} from "../packages/research/lanes.ts";

describe("structured AI model routing", () => {
  it("routes bookkeeping steps to direct DeepSeek", () => {
    expect(routeStructuredModel({ name: "cassie_intent" })).toMatchObject({
      provider: "deepseek",
      tier: "cheap",
      model: "deepseek-v4-flash",
    });
    expect(routeStructuredModel({ name: "cassie_signal" })).toMatchObject({
      provider: "deepseek",
      tier: "cheap",
    });
  });

  it("routes judgment steps to GPT-5.5 through OpenAI", () => {
    expect(routeStructuredModel({ name: "cassie_goal_resolution" })).toMatchObject({
      provider: "openai",
      tier: "expensive",
      model: "gpt-5.5",
    });
    expect(routeStructuredModel({ name: "cassie_research_report" })).toMatchObject({
      provider: "openai",
      tier: "expensive",
    });
    expect(routeStructuredModel({ name: "cassie_trade_expression" })).toMatchObject({
      provider: "openai",
      tier: "expensive",
    });
  });

  it("allows explicit tier overrides for structured calls", () => {
    expect(routeStructuredModel({ name: "custom_low_risk_step", tier: "cheap" })).toMatchObject({
      provider: "deepseek",
      tier: "cheap",
    });
    expect(routeStructuredModel({ name: "cassie_signal", tier: "expensive" })).toMatchObject({
      provider: "openai",
      tier: "expensive",
    });
  });

  it("surfaces missing DeepSeek key for cheap semantic work", async () => {
    const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    await expect(
      new OpenAiStructuredClient().generateObject({
        schema: {} as never,
        name: "cassie_intent",
        prompt: "test",
      }),
    ).rejects.toBeInstanceOf(MissingAiDependencyError);

    if (originalDeepSeekKey) {
      process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    }
  });

  it("defaults web search to direct Gemini Flash Lite", () => {
    const lane = new GeminiWebSearchLane("test-key");

    expect(lane).toHaveProperty("model", "gemini-3.1-flash-lite");
  });

  it("keeps direct provider generation ceilings below huge provider defaults", () => {
    expect(GEMINI_SEARCH_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(2_048);
    expect(DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(8_192);
  });

  it("defaults Grok X search to 4.3", () => {
    const lane = new GrokXSearchLane("test-key");

    expect(lane).toHaveProperty("model", "grok-4.3");
  });
});
