import { describe, expect, it } from "vitest";
import {
  buildXPostResolutionPrompt,
  parseXPostUrl,
  XPostResolutionError,
} from "../src/connectors/x-post-resolver.ts";

describe("X post resolver", () => {
  it("parses x.com status URLs into canonical locators", () => {
    expect(parseXPostUrl("https://x.com/_proxystudio/status/2057246023974875269?s=20")).toEqual({
      handle: "_proxystudio",
      postId: "2057246023974875269",
      canonicalUrl: "https://x.com/_proxystudio/status/2057246023974875269",
    });
  });

  it("parses twitter.com statuses URLs", () => {
    expect(parseXPostUrl("https://twitter.com/example/statuses/1234567890")).toEqual({
      handle: "example",
      postId: "1234567890",
      canonicalUrl: "https://x.com/example/status/1234567890",
    });
  });

  it("rejects non-X URLs", () => {
    expect(() => parseXPostUrl("https://example.com/post/123")).toThrow(XPostResolutionError);
  });

  it("builds a prompt that requires X Search and exact target resolution", () => {
    const prompt = buildXPostResolutionPrompt({
      handle: "_proxystudio",
      postId: "2057246023974875269",
      canonicalUrl: "https://x.com/_proxystudio/status/2057246023974875269",
    });

    expect(prompt).toContain("Use X Search");
    expect(prompt).toContain("Do not answer from memory");
    expect(prompt).toContain("2057246023974875269");
    expect(prompt).toContain("Fill the structured response schema directly");
  });
});
