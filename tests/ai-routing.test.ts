import { describe, expect, it, vi } from "vitest";
import {
  DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS,
  IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS,
  CassieStructuredClient,
  MissingAiDependencyError,
  extractModelThinkingTrace,
  openAiModelForStructuredCall,
  promptParametersForStructuredCall,
  providerOptionsForRoute,
  routeStructuredModel,
  structuredToolsForCall,
} from "../packages/ai/client.ts";

describe("structured AI model routing", () => {
  it("routes lightweight ranking steps to direct DeepSeek", () => {
    expect(
      routeStructuredModel({ name: "cassie_market_selection" }),
    ).toMatchObject({
      provider: "deepseek",
      tier: "cheap",
      model: "deepseek-v4-flash",
    });
  });

  it("routes judgment steps to GPT 5.4 mini", () => {
    expect(
      routeStructuredModel({ name: "cassie_trade_expressions" }),
    ).toMatchObject({
      provider: "openai",
      tier: "expensive",
      model: "gpt-5.4-mini",
    });
  });

  it("routes context discovery to Grok X search", () => {
    expect(
      routeStructuredModel({ name: "cassie_context_discovery" }),
    ).toMatchObject({
      provider: "xai",
      tier: "expensive",
      model: "grok-4.3",
    });
  });

  it("sets GPT 5.4 mini reasoning effort to medium for judgment calls", () => {
    expect(
      providerOptionsForRoute(
        routeStructuredModel({ name: "cassie_trade_expressions" }),
      ),
    ).toEqual({
      openai: {
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      },
    });
    expect(
      providerOptionsForRoute(
        routeStructuredModel({ name: "cassie_market_selection" }),
      ),
    ).toBeUndefined();
  });

  it("extracts only model-provided thinking trace text", () => {
    expect(
      extractModelThinkingTrace({
        reasoningText: "The model returned a reasoning summary.",
        reasoning: [],
      }),
    ).toBe("The model returned a reasoning summary.");
    expect(
      extractModelThinkingTrace({
        reasoning: [{ type: "reasoning", text: "A provider reasoning part." }],
      }),
    ).toBe("A provider reasoning part.");
    expect(extractModelThinkingTrace({ reasoning: [] })).toBeNull();
  });

  it("allows context discovery to use Grok web and X search", () => {
    const webSearch = vi.fn(() => ({ id: "xai.web_search" }));
    const xSearch = vi.fn(() => ({ id: "xai.x_search" }));
    const route = routeStructuredModel({ name: "cassie_context_discovery" });

    expect(
      structuredToolsForCall({
        route,
        tools: {
          webSearch: {
            externalWebAccess: true,
            searchContextSize: "medium",
          },
        },
        xai: { tools: { webSearch, xSearch } },
      }),
    ).toEqual({
      web_search: { id: "xai.web_search" },
      x_search: { id: "xai.x_search" },
    });
    expect(webSearch).toHaveBeenCalledWith({
      enableImageUnderstanding: true,
    });
    expect(xSearch).toHaveBeenCalledWith({
      enableImageUnderstanding: true,
      enableVideoUnderstanding: true,
    });
  });

  it("allows frame opportunity to use OpenAI built-in web search", () => {
    const webSearch = vi.fn(() => ({ id: "openai.web_search" }));
    const route = routeStructuredModel({ name: "cassie_opportunity_frame" });

    expect(
      structuredToolsForCall({
        route,
        tools: {
          webSearch: {
            externalWebAccess: true,
            searchContextSize: "low",
          },
        },
        openai: { tools: { webSearch } },
      }),
    ).toEqual({
      web_search: { id: "openai.web_search" },
    });
    expect(webSearch).toHaveBeenCalledWith({
      externalWebAccess: true,
      searchContextSize: "low",
    });
    expect(
      structuredToolsForCall({
        route: routeStructuredModel({ name: "cassie_trade_expressions" }),
        tools: undefined,
        openai: { tools: { webSearch } },
      }),
    ).toBeUndefined();
  });

  it("uses AI SDK messages when a structured prompt spec supplies them", () => {
    expect(
      promptParametersForStructuredCall({
        prompt: "legacy flat prompt",
        system: "system contract",
        messages: [{ role: "user", content: "structured payload" }],
      }),
    ).toEqual({
      system: "system contract",
      messages: [{ role: "user", content: "structured payload" }],
    });
    expect(
      promptParametersForStructuredCall({
        prompt: "legacy flat prompt",
      }),
    ).toEqual({
      prompt: "legacy flat prompt",
    });
  });

  it("uses the OpenAI Responses API for every OpenAI structured call", () => {
    const openai = Object.assign(
      vi.fn((model: string) => ({ kind: "responses", model })),
      { chat: vi.fn((model: string) => ({ kind: "chat", model })) },
    );
    const route = routeStructuredModel({ name: "cassie_opportunity_frame" });

    expect(openAiModelForStructuredCall({ route, openai })).toEqual({
      kind: "responses",
      model: "gpt-5.4-mini",
    });
    expect(
      openAiModelForStructuredCall({
        route: routeStructuredModel({ name: "cassie_trade_expressions" }),
        openai,
      }),
    ).toEqual({
      kind: "responses",
      model: "gpt-5.4-mini",
    });
    expect(openai.chat).not.toHaveBeenCalled();
  });

  it("allows explicit tier overrides for structured calls", () => {
    expect(
      routeStructuredModel({ name: "custom_low_risk_step", tier: "cheap" }),
    ).toMatchObject({
      provider: "deepseek",
      tier: "cheap",
    });
    expect(
      routeStructuredModel({
        name: "cassie_market_selection",
        tier: "expensive",
      }),
    ).toMatchObject({
      provider: "openai",
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
