import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { CassieProduct } from "../packages/app/product.ts";
import { runCassieSupervisorForRun } from "../packages/agent/agent.ts";
import { DrizzleCassieStore } from "../packages/core/db/drizzle-store.ts";
import { createCassieDb } from "../packages/core/db/client.ts";
import {
  auditEvents,
  controlRuns,
  executionJobs,
  mentions,
  modelCallUsage,
  runSteps,
  tradeTickets,
  userSettings,
} from "../packages/core/db/schema.ts";
import type { SourcePost, UserSettings } from "../packages/core/schemas/index.ts";

const requiredLiveEnv = [
  "DATABASE_URL",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "XAI_API_KEY",
] as const;

const missingLiveEnv = requiredLiveEnv.filter((name) => !process.env[name]?.trim());
const liveDescribe = missingLiveEnv.length === 0 ? describe : describe.skip;

const cleanupRunIds = new Set<string>();
const cleanupUserIds = new Set<string>();
const cleanupPool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const cleanupDb = cleanupPool ? createCassieDb(cleanupPool) : null;

afterEach(async () => {
  if (!cleanupDb || !cleanupPool) return;

  const runIds = [...cleanupRunIds];
  const userIds = [...cleanupUserIds];
  cleanupRunIds.clear();
  cleanupUserIds.clear();

  try {
    if (runIds.length > 0) {
      await cleanupDb.delete(modelCallUsage).where(inArray(modelCallUsage.controlRunId, runIds));
      await cleanupDb.delete(runSteps).where(inArray(runSteps.runId, runIds));
      await cleanupDb.delete(auditEvents).where(inArray(auditEvents.entityId, runIds));
      await cleanupDb.delete(tradeTickets).where(inArray(tradeTickets.runId, runIds));
      await cleanupDb.delete(controlRuns).where(inArray(controlRuns.runId, runIds));

      for (const runId of runIds) {
        await cleanupPool.query("select graphile_worker.remove_job($1)", [`cassie:run:${runId}`]);
      }
    }

    for (const userId of userIds) {
      await cleanupDb.delete(mentions).where(eq(mentions.userId, userId));
      await cleanupDb.delete(userSettings).where(eq(userSettings.userId, userId));
    }
  } catch (error) {
    console.warn(`Live integration cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

liveDescribe("live integration", () => {
  it("runs a real mention through Postgres, Graphile enqueueing, live AI, and persisted final state", async () => {
    const userId = `live-integration-${Date.now()}`;
    cleanupUserIds.add(userId);

    const settings: UserSettings = {
      userId,
      walletAddress: null,
      allowedVenues: ["hyperliquid", "polymarket"],
      defaultTradeSizeUsd: 25,
      maxTradeSizeUsd: 50,
      maxDailyLossUsd: 50,
      minConfidence: 0.75,
      maxSpreadBps: 100,
      maxSlippageBps: 100,
      maxPositionUsd: 500,
      autoTradeEnabled: false,
    };

    const sourcePost: SourcePost = {
      platform: "x",
      postId: `live_integration_${Date.now()}`,
      url: null,
      authorHandle: "cassie_live_fixture",
      authorName: "Cassie Live Fixture",
      text: "A major Solana ETF approval is basically guaranteed this quarter and SOL will reprice immediately.",
      createdAt: new Date().toISOString(),
    };

    const product = new CassieProduct(new DrizzleCassieStore());
    await product.upsertSettings(settings);
    const queued = await product.createMentionRun({
      userId,
      userCommand: "@Cassie critic this claim and tell me whether it is tradable",
      sourcePost,
    });
    cleanupRunIds.add(queued.runId);

    await runCassieSupervisorForRun({ runId: queued.runId, store: new DrizzleCassieStore() });

    const inspected = await product.getRun(queued.runId);
    const state = await product.state();
    const runStepsForRun = inspected.steps.map((step) => step.stepType);
    const modelUsageForRun = state.modelCallUsage.filter((usage) => usage.controlRunId === queued.runId);
    const auditsForRun = state.auditEvents.filter((event) => event.entityId === queued.runId);

    expect(inspected.run.status).toBe("succeeded");
    expect(inspected.run.result).toMatchObject({
      responseType: "analysis",
    });
    expect(runStepsForRun).toEqual(
      expect.arrayContaining(["intake", "opportunity", "trade_expression", "final"]),
    );
    expect(modelUsageForRun.length).toBeGreaterThan(0);
    expect(auditsForRun.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["agent.finished"]),
    );
    expect(state.tradeTickets.filter((ticket) => ticket.runId === queued.runId)).toHaveLength(0);
  }, 900_000);
});

if (missingLiveEnv.length > 0) {
  console.warn(`Skipping live integration tests. Missing: ${missingLiveEnv.join(", ")}`);
}
