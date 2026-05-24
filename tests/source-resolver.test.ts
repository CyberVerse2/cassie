import { describe, expect, it, vi } from "vitest";
import { MissingConnectorConfigError } from "../packages/core/helpers/index.ts";
import { XApiSourceResolver, parseXStatusUrl } from "../packages/agent/source.ts";

describe("X API source resolver", () => {
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

  it("looks up a tweet and normalizes it into SourcePost", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          id: "2057246023974875269",
          text: "OpenAI revenue growth is accelerating ahead of a potential IPO.",
          author_id: "user_1",
          created_at: "2026-05-24T00:00:00.000Z",
          entities: {
            urls: [{ expanded_url: "https://example.com/source" }],
          },
        },
        includes: {
          users: [{ id: "user_1", username: "example", name: "Example" }],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const source = await new XApiSourceResolver("bearer-token", "https://api.x.test/2/tweets")
      .resolveSource({ url: "https://x.com/example/status/2057246023974875269" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("https://api.x.test/2/tweets/2057246023974875269"),
      }),
      expect.objectContaining({
        headers: { Authorization: "Bearer bearer-token" },
      }),
    );
    expect(source).toMatchObject({
      platform: "x",
      postId: "2057246023974875269",
      url: "https://x.com/example/status/2057246023974875269",
      authorHandle: "example",
      authorName: "Example",
      text: "OpenAI revenue growth is accelerating ahead of a potential IPO.",
      createdAt: "2026-05-24T00:00:00.000Z",
      linkedUrls: ["https://example.com/source"],
    });

    fetchMock.mockRestore();
  });

  it("surfaces missing X bearer token configuration", async () => {
    await expect(new XApiSourceResolver(undefined).resolveSource({
      url: "https://x.com/example/status/2057246023974875269",
    })).rejects.toBeInstanceOf(MissingConnectorConfigError);
  });
});
