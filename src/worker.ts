import "dotenv/config";
import { runExecutionWorker } from "./jobs/execution-jobs.js";

const runner = await runExecutionWorker();

console.log("Cassie Graphile Worker started.");

await runner.promise;
