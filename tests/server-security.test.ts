import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { MemoryRateLimiter, RateLimitError } from "../src/security.ts";

describe("server route security", () => {
  it("does not expose legacy slash-api routes", async () => {
    const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

    expect(source).not.toContain('"/api/');
    expect(source).not.toContain("authorization");
    expect(source).not.toContain("401");
    expect(source).toContain("/^\\/tickets\\/([^/]+)\\/approve$/");
  });

  it("expires rate-limit buckets instead of retaining stale request keys", () => {
    vi.useFakeTimers();
    try {
      const limiter = new MemoryRateLimiter(1, 1000);

      limiter.check("client-a");
      expect(() => limiter.check("client-a")).toThrow(RateLimitError);

      vi.advanceTimersByTime(1001);
      expect(() => limiter.check("client-a")).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
