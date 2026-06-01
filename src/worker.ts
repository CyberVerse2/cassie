import "dotenv/config";
import { runExecutionWorker } from "../packages/jobs/worker.ts";

const runner = await runExecutionWorker();
let stopping = false;

async function stopWorker(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  console.log(`Cassie Graphile Worker stopping after ${signal}.`);
  await runner.stop();
}

process.once("SIGINT", () => void stopWorker("SIGINT"));
process.once("SIGTERM", () => void stopWorker("SIGTERM"));

console.log("Cassie Graphile Worker started.");

await runner.promise;
