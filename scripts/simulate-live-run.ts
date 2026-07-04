import "dotenv/config";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createCassieDb } from "../packages/core/db/client.ts";
import { controlRuns, runSteps } from "../packages/core/db/schema.ts";
import { DrizzleCassieStore } from "../packages/core/db/drizzle-store.ts";
import type { RunStep } from "../packages/core/schemas/index.ts";

// Simulates a live pipeline run for a user so the dashboard's live run card
// can be watched end-to-end without waiting for a real X mention. Inserts a
// running control run, steps through the stages with realistic pacing, ends
// it as a reasoned pass, then cleans everything up.
// Usage: npx tsx scripts/simulate-live-run.ts [handle] [--keep]

const handle = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
const keep = process.argv.includes("--keep");
const db = createCassieDb();
const store = new DrizzleCassieStore();

const settings = await store.getUserSettingsByXIdentity({
  username: handle ?? "thecyberverse",
});
if (!settings) throw new Error(`No user found for @${handle ?? "thecyberverse"}.`);
console.log(`simulating a live run for ${settings.userId} (@${settings.profile.handle})`);

const runId = `sim-${randomUUID()}`;
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

await db.insert(controlRuns).values({
  runId,
  userId: settings.userId,
  userCommand: "trade this",
  sourcePost: {
    platform: "x",
    postId: "0",
    url: "https://x.com/EffortCapital/status/1932847171004723506",
    authorHandle: "EffortCapital",
    authorName: "David",
    text: "Morpho raised more than the entire FDV of Kamino. The market is heavily (and incorrectly) discounting lending protocols right now.",
    createdAt: now(),
  },
  status: "running",
  result: null,
  error: null,
  createdAt: now(),
  updatedAt: now(),
});
console.log(`run ${runId} inserted (running) — watch the dashboard`);

type SimStep = {
  stepType: RunStep["stepType"];
  promptName?: string;
  runMs: number;
  output: unknown;
};

const script: SimStep[] = [
  {
    stepType: "intake",
    promptName: "cassie_source_mode_classification",
    runMs: 4000,
    output: {
      headlineThesis:
        "Lending protocols are underpriced relative to fundraising interest; MORPHO is the direct beneficiary.",
      userIntent: "trade",
    },
  },
  {
    stepType: "opportunity",
    runMs: 6000,
    output: {
      opportunityFrame: {
        opportunity:
          "If private-market appetite for lending is real, liquid lending tokens reprice upward near-term. Horizon: days to weeks.",
      },
    },
  },
  {
    stepType: "trade_expression",
    runMs: 5000,
    output: {
      highestPurityExpression:
        "Long MORPHO outright — the named protocol, cleanest read-through from the raise.",
    },
  },
  {
    stepType: "market_candidates",
    runMs: 4000,
    output: [{ venue: "hyperliquid" }, { venue: "hyperliquid" }],
  },
  {
    stepType: "market_assessment",
    runMs: 4000,
    output: {
      semanticFitSummary:
        "MORPHO perp is a direct expression of the lending repricing thesis on a configured venue.",
    },
  },
  {
    stepType: "market_selection",
    runMs: 3000,
    output: {
      selectedMarket: { symbol: "MORPHO", venue: "hyperliquid" },
    },
  },
];

for (const step of script) {
  const stepId = randomUUID();
  await db.insert(runSteps).values({
    stepId,
    runId,
    stepType: step.stepType,
    status: "running",
    input: null,
    output: null,
    error: null,
    model: null,
    promptName: step.promptName ?? null,
    promptVersion: null,
    thinkingTrace: null,
    startedAt: now(),
    completedAt: null,
  });
  console.log(`  ${step.stepType} running…`);
  await sleep(step.runMs);
  await db
    .update(runSteps)
    .set({ status: "succeeded", output: step.output, completedAt: now() })
    .where(eq(runSteps.stepId, stepId));
  console.log(`  ${step.stepType} ✓`);
}

await sleep(2000);
await db
  .update(controlRuns)
  .set({
    status: "succeeded",
    result: {
      responseType: "analysis",
      actionState: "no_trade",
      publicSummary:
        "Passed — MORPHO quotes were too thin at your size right now. The thesis is sound; she'll take it when the book can carry it.",
      runStatus: "succeeded",
      ticketId: null,
      warnings: [],
    },
    updatedAt: now(),
  })
  .where(eq(controlRuns.runId, runId));
console.log("run resolved: passed with reason (visible on the card)");

if (!keep) {
  console.log("cleaning up in 45s… (Ctrl-C to keep)");
  await sleep(45_000);
  await db.delete(runSteps).where(eq(runSteps.runId, runId));
  await db.delete(controlRuns).where(eq(controlRuns.runId, runId));
  console.log("simulation rows deleted");
}
process.exit(0);
