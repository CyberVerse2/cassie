import { run } from "graphile-worker";
import { config } from "../core/config.ts";
import { createPostgresPool, MissingDatabaseConfigError } from "../core/db/client.ts";
import { createExecutionTaskList } from "./tasks.ts";

export async function runExecutionWorker() {
  if (!config.database.url) {
    throw new MissingDatabaseConfigError();
  }

  const pool = createPostgresPool();
  return run({
    pgPool: pool,
    taskList: createExecutionTaskList(),
    concurrency: config.graphileWorker.concurrency,
    pollInterval: config.graphileWorker.pollIntervalMs,
  });
}
