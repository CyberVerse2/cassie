import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

export type CassieDb = NodePgDatabase<typeof schema>;

export type DatabaseUrlSummary = {
  protocol: string;
  username: string;
  host: string;
  port: string;
  database: string;
  passwordLength: number;
  passwordMatchesPostgresPassword: boolean | null;
  passwordIsDefaultPostgres: boolean;
};

let sharedPostgresPool: Pool | null = null;

export class MissingDatabaseConfigError extends Error {
  constructor() {
    super("Postgres is not configured. Set DATABASE_URL.");
    this.name = "MissingDatabaseConfigError";
  }
}

export function createPostgresPool(databaseUrl = config.database.url): Pool {
  if (!databaseUrl) {
    throw new MissingDatabaseConfigError();
  }

  const pool = new Pool(postgresPoolConfig(databaseUrl));
  pool.on("error", (error) => {
    console.error("Postgres idle connection error", error);
  });
  return pool;
}

export function postgresPoolConfig(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,
    max: config.database.pool.max,
    connectionTimeoutMillis: config.database.pool.connectionTimeoutMs,
    idleTimeoutMillis: config.database.pool.idleTimeoutMs,
    maxLifetimeSeconds: config.database.pool.maxLifetimeSeconds,
  };
}

export function summarizeDatabaseUrl(
  databaseUrl: string,
  postgresPassword = process.env.POSTGRES_PASSWORD,
): DatabaseUrlSummary {
  const url = new URL(databaseUrl);
  return {
    protocol: url.protocol,
    username: url.username,
    host: url.hostname,
    port: url.port,
    database: url.pathname.replace(/^\//u, ""),
    passwordLength: url.password.length,
    passwordMatchesPostgresPassword: postgresPassword == null ? null : url.password === postgresPassword,
    passwordIsDefaultPostgres: url.password === "postgres",
  };
}

export function sharedCassiePostgresPool(): Pool {
  if (!sharedPostgresPool) {
    sharedPostgresPool = createPostgresPool();
  }
  return sharedPostgresPool;
}

export function createCassieDb(pool = sharedCassiePostgresPool()): CassieDb {
  return drizzle(pool, { schema });
}
