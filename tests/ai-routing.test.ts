import { describe, expect, it } from "vitest";
import {
  MissingAiDependencyError,
  OpenAiStructuredClient,
  routeStructuredModel,
} from "../packages/ai/client.ts";
import {
  GrokXSearchLane,
  OpenAiWebSearchLane,
} from "../packages/research/lanes.ts";
import {
  OPENROUTER_SEARCH_MAX_OUTPUT_TOKENS,
  OPENROUTER_STRUCTURED_MAX_OUTPUT_TOKENS,
} from "../packages/ai/openrouter-options.ts";

describe("structured AI model routing", () => {
  it("routes bookkeeping steps to DeepSeek through OpenRouter", () => {
    expect(routeStructuredModel({ name: "cassie_evidence_ledger" })).toMatchObject({
      provider: "openrouter",
      tier: "cheap",
      model: "deepseek/deepseek-v4-flash",
    });
    expect(routeStructuredModel({ name: "cassie_intent" })).toMatchObject({
      provider: "openrouter",
      tier: "cheap",
    });
    expect(routeStructuredModel({ name: "cassie_signal" })).toMatchObject({
      provider: "openrouter",
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
      provider: "openrouter",
      tier: "cheap",
    });
    expect(routeStructuredModel({ name: "cassie_signal", tier: "expensive" })).toMatchObject({
      provider: "openai",
      tier: "expensive",
    });
  });

  it("surfaces missing OpenRouter key for cheap semantic work", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await expect(
      new OpenAiStructuredClient().generateObject({
        schema: {} as never,
        name: "cassie_evidence_ledger",
        prompt: "test",
      }),
    ).rejects.toBeInstanceOf(MissingAiDependencyError);

    if (originalOpenRouterKey) {
      process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    }
  });

  it("defaults web search to Gemini Flash Lite through OpenRouter", () => {
    const lane = new OpenAiWebSearchLane("test-key");

    expect(lane).toHaveProperty("model", "google/gemini-3.1-flash-lite");
  });

  it("keeps OpenRouter generation ceilings below huge provider defaults", () => {
    expect(OPENROUTER_SEARCH_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(2_048);
    expect(OPENROUTER_STRUCTURED_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(8_192);
  });

  it("defaults Grok X search to 4.3", () => {
    const lane = new GrokXSearchLane("test-key");

    expect(lane).toHaveProperty("model", "grok-4.3");
  });
});
