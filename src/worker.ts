import "dotenv/config";
import { runExecutionWorker } from "../packages/jobs/index.ts";

const runner = await runExecutionWorker();

console.log("Cassie Graphile Worker started.");

await runner.promise;
