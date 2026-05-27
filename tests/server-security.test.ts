import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { MemoryRateLimiter, RateLimitError } from "../src/security.ts";

describe("server route security", () => {
  it("does not gate local control routes behind token checks", async () => {
    const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

    const stateRoute = routeBlock(source, "GET", "/api/state");
    const settingsRoute = routeBlock(source, "POST", "/api/settings");

    expect(stateRoute).not.toContain("authorization");
    expect(stateRoute).not.toContain("401");
    expect(stateRoute).toContain("product.state()");
    expect(settingsRoute).not.toContain("authorization");
    expect(settingsRoute).not.toContain("401");
    expect(settingsRoute).toContain("product.upsertSettings");
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

function routeBlock(source: string, method: string, path: string): string {
  const start = source.indexOf(`request.method === "${method}" && url.pathname === "${path}"`);
  expect(start).toBeGreaterThan(-1);

  const nextRoute = source.indexOf("\n  if (request.method ===", start + 1);
  return source.slice(start, nextRoute === -1 ? undefined : nextRoute);
}
