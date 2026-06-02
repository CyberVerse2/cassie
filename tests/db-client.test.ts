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

  it("summarizes database URLs without exposing credentials", async () => {
    const { summarizeDatabaseUrl } = await import("../packages/core/db/client.ts");

    expect(summarizeDatabaseUrl("postgresql://postgres:postgres@postgres:5432/cassie", "postgres")).toEqual({
      protocol: "postgresql:",
      username: "postgres",
      host: "postgres",
      port: "5432",
      database: "cassie",
      passwordLength: 8,
      passwordMatchesPostgresPassword: true,
      passwordIsDefaultPostgres: true,
    });
    expect(summarizeDatabaseUrl("postgresql://postgres:wrong@postgres:5432/cassie", "postgres"))
      .toMatchObject({
        passwordLength: 5,
        passwordMatchesPostgresPassword: false,
        passwordIsDefaultPostgres: false,
      });
  });
});
