import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server route security", () => {
  it("serves the dashboard without API-token auth while keeping state API protected", async () => {
    const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

    expect(routeBlock(source, "GET", "/dashboard")).not.toContain("requireApiToken");
    expect(routeBlock(source, "GET", "/api/state")).toContain("requireApiToken");
  });
});

function routeBlock(source: string, method: string, path: string): string {
  const start = source.indexOf(`request.method === "${method}" && url.pathname === "${path}"`);
  expect(start).toBeGreaterThan(-1);

  const nextRoute = source.indexOf("\n  if (request.method ===", start + 1);
  return source.slice(start, nextRoute === -1 ? undefined : nextRoute);
}
