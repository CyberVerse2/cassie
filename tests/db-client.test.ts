import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Cassie DB client", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://cassie";
  });

  it("reuses one default Postgres pool per process", async () => {
    const { sharedCassiePostgresPool } = await import("../packages/core/db/client.ts");

    expect(sharedCassiePostgresPool()).toBe(sharedCassiePostgresPool());
  });

  it("can create multiple Drizzle clients over the shared pool", async () => {
    const { createCassieDb, sharedCassiePostgresPool } = await import("../packages/core/db/client.ts");

    expect(createCassieDb()).toBeDefined();
    expect(createCassieDb()).toBeDefined();
    expect(sharedCassiePostgresPool().totalCount).toBe(0);
  });
});
