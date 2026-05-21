import { describe, expect, it } from "vitest";
import {
  MissingAiDependencyError,
  OpenAiStructuredClient,
  routeStructuredModel,
} from "../src/ai.ts";
import { OpenAiWebSearchLane } from "../src/connectors/research-lanes.ts";

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

  it("defaults OpenAI web search to the mini search operator model", () => {
    const lane = new OpenAiWebSearchLane("test-key");

    expect(lane).toHaveProperty("model", "gpt-5.4-mini");
  });
});
