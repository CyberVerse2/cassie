import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

export type CassieDb = NodePgDatabase<typeof schema>;

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

  return new Pool({ connectionString: databaseUrl });
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
