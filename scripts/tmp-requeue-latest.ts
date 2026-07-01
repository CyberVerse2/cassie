import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { createCassieDb, sharedCassiePostgresPool } from "../packages/core/db/client.ts";
import { DrizzleCassieStore } from "../packages/core/db/drizzle-store.ts";
import { GraphileExecutionJobQueue } from "../packages/jobs/queue.ts";
import {
  auditEvents,
  controlRuns,
  executionJobs,
  modelCallUsage,
  positions,
  runSteps,
  tradeTickets,
  walletSpendLedgerEntries,
} from "../packages/core/db/schema.ts";

const db = createCassieDb();
const store = new DrizzleCassieStore();
const jobQueue = new GraphileExecutionJobQueue();

try {
  const latestRows = await db
    .select()
    .from(controlRuns)
    .orderBy(controlRuns.createdAt)
    .limit(1000);
  const oldRun = latestRows.at(-1);
  if (!oldRun) throw new Error("No control runs found.");

  const request = {
    userId: oldRun.userId,
    userCommand: oldRun.userCommand,
    sourcePost: oldRun.sourcePost,
  };

  const oldTicketRows = await db.select().from(tradeTickets).where(eq(tradeTickets.runId, oldRun.runId));
  const oldTicketIds = oldTicketRows.map((row) => row.ticketId);
  const oldJobRows = oldTicketIds.length
    ? await db.select().from(executionJobs).where(inArray(executionJobs.ticketId, oldTicketIds))
    : [];
  const oldJobIds = oldJobRows.map((row) => row.jobId);

  if (oldJobIds.length > 0) {
    await db.delete(walletSpendLedgerEntries).where(inArray(walletSpendLedgerEntries.executionJobId, oldJobIds));
    await db.delete(positions).where(inArray(positions.executionJobId, oldJobIds));
    await db.delete(executionJobs).where(inArray(executionJobs.jobId, oldJobIds));
  }
  if (oldTicketIds.length > 0) {
    await db.delete(walletSpendLedgerEntries).where(inArray(walletSpendLedgerEntries.ticketId, oldTicketIds));
    await db.delete(tradeTickets).where(inArray(tradeTickets.ticketId, oldTicketIds));
  }
  await db.delete(modelCallUsage).where(eq(modelCallUsage.controlRunId, oldRun.runId));
  await db.delete(runSteps).where(eq(runSteps.runId, oldRun.runId));
  await db.delete(auditEvents).where(eq(auditEvents.entityId, oldRun.runId));
  await db.delete(controlRuns).where(eq(controlRuns.runId, oldRun.runId));

  const newRun = await store.createRun(request);
  await store.addRunStep({
    runId: newRun.runId,
    stepType: "intake",
    status: "succeeded",
    input: request,
    output: { queued: true },
    error: null,
    model: null,
    promptName: null,
    promptVersion: null,
    completedAt: new Date().toISOString(),
  });
  const queued = await jobQueue.enqueueSupervisor(newRun);

  console.log(JSON.stringify({
    deletedRun: {
      runId: oldRun.runId,
      status: oldRun.status,
      userCommand: oldRun.userCommand,
      createdAt: oldRun.createdAt,
      result: oldRun.result,
      error: oldRun.error,
    },
    queuedRun: {
      runId: newRun.runId,
      status: newRun.status,
      userCommand: newRun.userCommand,
      createdAt: newRun.createdAt,
    },
    graphileJobId: queued.graphileJobId,
  }, null, 2));
} finally {
  await sharedCassiePostgresPool().end();
}
