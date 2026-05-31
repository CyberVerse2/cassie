import { describe, expect, it, vi } from "vitest";
import { MissingConnectorConfigError } from "../packages/core/helpers/connector-errors.ts";
import {
  GrokXSourceResolutionError,
  GrokXSourceResolver,
  buildGrokSourceResolutionPrompt,
  parseXStatusUrl,
} from "../packages/agent/source.ts";

describe("Grok X source resolver", () => {
  it("parses X and Twitter status URLs into canonical locators", () => {
    expect(parseXStatusUrl("https://x.com/example/status/2057246023974875269?s=20")).toEqual({
      handle: "example",
      postId: "2057246023974875269",
      canonicalUrl: "https://x.com/example/status/2057246023974875269",
    });
    expect(parseXStatusUrl("https://twitter.com/example/statuses/1234567890")).toEqual({
      handle: "example",
      postId: "1234567890",
      canonicalUrl: "https://x.com/example/status/1234567890",
    });
  });

  it("builds a prompt that requires exact post resolution without invention", () => {
    const prompt = buildGrokSourceResolutionPrompt({
      handle: "example",
      postId: "2057246023974875269",
      canonicalUrl: "https://x.com/example/status/2057246023974875269",
    });

    expect(prompt).toContain("https://x.com/example/status/2057246023974875269");
    expect(prompt).toContain("2057246023974875269");
    expect(prompt).toContain("Role:");
    expect(prompt).toContain("When uncertain:");
    expect(prompt).not.toContain("Stage role:");
    expect(prompt).not.toContain("Output contract:");
    expect(prompt).toContain("same topic from the same author but a different status ID");
    expect(prompt).toContain("Before returning, verify internally");
    expect(prompt).toContain("Do not infer, summarize, embellish, or invent");
  });

  it("uses Grok X search to resolve a tweet and normalizes known locator fields", async () => {
    const generate = vi.fn(async () => ({
      found: true,
      reason: null,
      sourcePost: {
        platform: "x" as const,
        postId: null,
        url: null,
        authorHandle: null,
        authorName: "Example",
        text: "OpenAI revenue growth is accelerating ahead of a potential IPO.",
        createdAt: "2026-05-24T00:00:00.000Z",
        quotedPostText: null,
        linkedUrls: ["https://example.com/source"],
        mediaDescriptions: ["Chart showing revenue acceleration."],
      },
    }));

    const source = await new GrokXSourceResolver("xai-key", "grok-test", undefined, generate)
      .resolveSource({ url: "https://x.com/example/status/2057246023974875269" });

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "xai-key",
      model: "grok-test",
      locator: {
        handle: "example",
        postId: "2057246023974875269",
        canonicalUrl: "https://x.com/example/status/2057246023974875269",
      },
    }));
    expect(source).toMatchObject({
      platform: "x",
      postId: "2057246023974875269",
      url: "https://x.com/example/status/2057246023974875269",
      authorHandle: "example",
      authorName: "Example",
      text: "OpenAI revenue growth is accelerating ahead of a potential IPO.",
      createdAt: "2026-05-24T00:00:00.000Z",
      quotedPostText: null,
      linkedUrls: ["https://example.com/source"],
      mediaDescriptions: ["Chart showing revenue acceleration."],
    });
  });

  it("surfaces missing XAI configuration", async () => {
    await expect(new GrokXSourceResolver(undefined).resolveSource({
      url: "https://x.com/example/status/2057246023974875269",
    })).rejects.toBeInstanceOf(MissingConnectorConfigError);
  });

  it("fails when Grok cannot resolve the exact post", async () => {
    const generate = vi.fn(async () => ({
      found: false,
      reason: "The exact status was not available to X search.",
      sourcePost: null,
    }));

    await expect(new GrokXSourceResolver("xai-key", "grok-test", undefined, generate)
      .resolveSource({ url: "https://x.com/example/status/2057246023974875269" }))
      .rejects.toThrow(GrokXSourceResolutionError);
  });

});
