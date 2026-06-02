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

  it("reuses the default Postgres pool across module reloads", async () => {
    const { sharedCassiePostgresPool } = await import("../packages/core/db/client.ts");
    const pool = sharedCassiePostgresPool();

    vi.resetModules();
    const reloaded = await import("../packages/core/db/client.ts");

    expect(reloaded.sharedCassiePostgresPool()).toBe(pool);
  });

  it("can create multiple Drizzle clients over the shared pool", async () => {
    const { createCassieDb, sharedCassiePostgresPool } = await import("../packages/core/db/client.ts");

    expect(createCassieDb()).toBeDefined();
    expect(createCassieDb()).toBeDefined();
    expect(sharedCassiePostgresPool().totalCount).toBe(0);
  });

  it("applies bounded Postgres pool settings and idle error handling", async () => {
    process.env.CASSIE_DATABASE_POOL_MAX = "4";
    process.env.CASSIE_DATABASE_CONNECTION_TIMEOUT_MS = "2500";
    process.env.CASSIE_DATABASE_IDLE_TIMEOUT_MS = "20000";
    process.env.CASSIE_DATABASE_MAX_LIFETIME_SECONDS = "120";

    const { createPostgresPool, postgresPoolConfig } = await import("../packages/core/db/client.ts");
    const pool = createPostgresPool("postgres://cassie");

    expect(postgresPoolConfig("postgres://cassie")).toMatchObject({
      connectionString: "postgres://cassie",
      max: 4,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 20000,
      maxLifetimeSeconds: 120,
    });
    expect(pool.listenerCount("error")).toBe(1);

    await pool.end();
  });

  it("rejects malformed database URLs without exposing credentials", async () => {
    const { postgresPoolConfig } = await import("../packages/core/db/client.ts");
    const malformedUrl = "postgresql://postgres:secret/with/slash@postgres:5432/cassie";

    expect(() => postgresPoolConfig(malformedUrl)).toThrow(
      "DATABASE_URL is not a valid Postgres URL. Percent-encode the username and password before putting them in the URL.",
    );
    expect(() => postgresPoolConfig(malformedUrl)).not.toThrow(/secret\/with\/slash/u);
  });
});
