import "dotenv/config";
import { runExecutionWorker } from "./jobs/execution-jobs.ts";

const runner = await runExecutionWorker();

console.log("Cassie Graphile Worker started.");

await runner.promise;
