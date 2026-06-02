import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { config } from "../packages/core/config.ts";
import { createCassieDb } from "../packages/core/db/client.ts";

const databaseUrl = config.database.url;

if (!databaseUrl) {
  throw new Error("DATABASE_URL or CASSIE_POSTGRES_HOST/CASSIE_POSTGRES_PASSWORD is required to run migrations.");
}

const lockTimeoutMs = Number(process.env.DB_MIGRATION_LOCK_TIMEOUT_MS ?? 10_000);
const statementTimeoutMs = Number(process.env.DB_MIGRATION_STATEMENT_TIMEOUT_MS ?? 120_000);

if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
  throw new Error("DB_MIGRATION_LOCK_TIMEOUT_MS must be a positive integer.");
}
if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
  throw new Error("DB_MIGRATION_STATEMENT_TIMEOUT_MS must be a positive integer.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  options: [
    "-c",
    `lock_timeout=${lockTimeoutMs}`,
    "-c",
    `statement_timeout=${statementTimeoutMs}`,
    "-c",
    `idle_in_transaction_session_timeout=${statementTimeoutMs}`,
  ].join(" "),
});

try {
  console.log(`Running database migrations with lock_timeout=${lockTimeoutMs}ms statement_timeout=${statementTimeoutMs}ms.`);
  await migrate(createCassieDb(pool), { migrationsFolder: "./drizzle" });
  console.log("Database migrations completed.");
} catch (error) {
  if (error instanceof Error && /lock timeout|canceling statement due to statement timeout/iu.test(error.message)) {
    throw new Error(`${error.message}\nStop active web/worker processes using the database, then rerun migrations.`);
  }
  throw error;
} finally {
  await pool.end();
}
