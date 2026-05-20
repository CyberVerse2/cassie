import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type CassieDb = NodePgDatabase<typeof schema>;

export class MissingDatabaseConfigError extends Error {
  constructor() {
    super("Postgres is not configured. Set DATABASE_URL.");
    this.name = "MissingDatabaseConfigError";
  }
}

export function createPostgresPool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) {
    throw new MissingDatabaseConfigError();
  }

  return new Pool({ connectionString: databaseUrl });
}

export function createCassieDb(pool = createPostgresPool()): CassieDb {
  return drizzle(pool, { schema });
}
