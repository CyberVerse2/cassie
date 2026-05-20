# Cassie Control Plane Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Cassie from a synchronous prompt-chain into an API-first control plane with durable runs, recorded steps, AI SDK tool-loop orchestration, and separate execution.

**Architecture:** API requests create durable `CassieRun` records and return `runId`; background orchestration executes bounded tools and records every step. The AI SDK supervisor chooses semantic tools, while deterministic tools own risk, ticket creation, and execution boundaries.

**Tech Stack:** TypeScript, Node HTTP server, Vercel AI SDK `generateText`/`tool`/`stepCountIs`, Zod, Drizzle/Postgres, Graphile Worker, Vitest.

---

## File Structure

- Modify `src/schemas.ts`: add run status, run step, supervisor result, and approval/recommendation schemas.
- Modify `src/store.ts`: extend `CassieStore` with run and step persistence methods.
- Modify `src/db/schema.ts`: add tables or columns needed for durable runs and steps.
- Modify `src/db/store.ts`: implement durable run/step methods in Drizzle.
- Modify `src/product.ts`: make mention intake create a run and enqueue the supervisor job instead of synchronously completing the whole pipeline.
- Modify `src/jobs/execution-jobs.ts`: add a supervisor job type, queue class method, and worker task.
- Create `src/supervisor/tools.ts`: define AI SDK tools wrapping existing bounded functions.
- Create `src/supervisor/agent.ts`: implement the AI SDK tool-loop supervisor.
- Create `src/supervisor/steps.ts`: helper functions for recording tool steps and prompt metadata.
- Modify `src/tools/research.ts`: make lane failure warnings explicit in `ResearchReport`.
- Modify `src/server.ts`: return `{ runId, status }` from `/api/mentions`; add run inspection endpoints.
- Add tests in `tests/control-plane.test.ts`: run creation, step recording, queued supervisor execution, no direct execution.
- Add tests in `tests/supervisor-agent.test.ts`: tool-loop path, bounded tool calls, final structured result.
- Update `README.md`: describe API-first control-plane behavior.

## Task 1: Durable Run And Step Model

**Files:**
- Modify: `src/schemas.ts`
- Modify: `src/store.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/store.ts`
- Test: `tests/control-plane.test.ts`

- [ ] **Step 1: Write failing run/step store test**

Add this test to `tests/control-plane.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../src/store.ts";
import type { SourcePost } from "../src/schemas.ts";

const sourcePost: SourcePost = {
  platform: "x",
  postId: "post_1",
  url: "https://x.com/example/status/post_1",
  authorHandle: "example",
  authorName: "Example",
  text: "Solana ETF approval is basically inevitable now. Market is asleep.",
  createdAt: "2026-05-20T12:00:00Z",
};

describe("control plane run persistence", () => {
  it("creates a durable run and records ordered steps", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });

    const started = await store.addRunStep({
      runId: run.runId,
      stepType: "intent",
      status: "running",
      input: { userCommand: "@Cassie get me in" },
      output: null,
      error: null,
      model: "gpt-5.5",
      promptName: "cassie_intent",
      promptVersion: "2026-05-20",
    });

    await store.updateRunStep({
      ...started,
      status: "succeeded",
      output: { intent: "trade" },
      completedAt: "2026-05-20T12:00:01.000Z",
    });

    const state = await store.load();
    expect(state.controlRuns[0]?.status).toBe("queued");
    expect(state.runSteps).toHaveLength(1);
    expect(state.runSteps[0]?.stepType).toBe("intent");
    expect(state.runSteps[0]?.output).toEqual({ intent: "trade" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/control-plane.test.ts`

Expected: FAIL because `createRun`, `addRunStep`, `updateRunStep`, `controlRuns`, and `runSteps` do not exist yet.

- [ ] **Step 3: Add schemas**

In `src/schemas.ts`, add these schemas and exports:

```ts
export const ControlRunStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);

export const RunStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const RunStepTypeSchema = z.enum([
  "intake",
  "intent",
  "thesis",
  "inverse_thesis",
  "research",
  "critique",
  "market_candidates",
  "market_selection",
  "risk",
  "ticket",
  "final",
]);

export const ControlRunSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  userCommand: z.string(),
  sourcePost: SourcePostSchema,
  status: ControlRunStatusSchema,
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RunStepSchema = z.object({
  stepId: z.string(),
  runId: z.string(),
  stepType: RunStepTypeSchema,
  status: RunStepStatusSchema,
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  promptName: z.string().nullable(),
  promptVersion: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type ControlRunStatus = z.infer<typeof ControlRunStatusSchema>;
export type RunStepStatus = z.infer<typeof RunStepStatusSchema>;
export type RunStepType = z.infer<typeof RunStepTypeSchema>;
export type ControlRun = z.infer<typeof ControlRunSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
```

- [ ] **Step 4: Extend store interface and in-memory store**

In `src/store.ts`, add `controlRuns` and `runSteps` to `CassieStoreSnapshot`, then add these methods to `CassieStore`:

```ts
createRun(input: {
  userId: string;
  userCommand: string;
  sourcePost: SourcePost;
}): Promise<ControlRun>;
updateRun(run: ControlRun): Promise<ControlRun>;
getRun(runId: string): Promise<ControlRun | undefined>;
addRunStep(input: Omit<RunStep, "stepId" | "startedAt">): Promise<RunStep>;
updateRunStep(step: RunStep): Promise<RunStep>;
getRunSteps(runId: string): Promise<RunStep[]>;
```

Implement the same methods in `InMemoryCassieStore` using arrays, `randomUUID()`, and ISO timestamps.

- [ ] **Step 5: Add Drizzle tables and store methods**

In `src/db/schema.ts`, add:

```ts
export const controlRuns = pgTable("control_runs", {
  runId: text("run_id").primaryKey(),
  userId: text("user_id").notNull(),
  userCommand: text("user_command").notNull(),
  sourcePost: jsonb("source_post").$type<SourcePost>().notNull(),
  status: text("status").notNull(),
  result: jsonb("result"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runSteps = pgTable("run_steps", {
  stepId: text("step_id").primaryKey(),
  runId: text("run_id").notNull(),
  stepType: text("step_type").notNull(),
  status: text("status").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  model: text("model"),
  promptName: text("prompt_name"),
  promptVersion: text("prompt_version"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});
```

In `src/db/store.ts`, include both tables in `load()` and implement the new interface methods using `insert`, `update`, `where(eq(...))`, and `limit(1)`.

- [ ] **Step 6: Run test and build**

Run: `npm test -- tests/control-plane.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/schemas.ts src/store.ts src/db/schema.ts src/db/store.ts tests/control-plane.test.ts
git commit -m "feat: add durable run step model"
```

## Task 2: Supervisor Job Intake

**Files:**
- Modify: `src/jobs/execution-jobs.ts`
- Modify: `src/product.ts`
- Modify: `src/server.ts`
- Test: `tests/control-plane.test.ts`

- [ ] **Step 1: Write failing intake test**

Add this test to `tests/control-plane.test.ts`:

```ts
it("mention intake creates a queued run without executing the supervisor synchronously", async () => {
  const store = new InMemoryCassieStore();
  const enqueued: string[] = [];
  const product = new CassieProduct(
    store,
    undefined,
    null,
    undefined,
    {
      async enqueueExecution() {
        throw new Error("execution must not be queued during intake");
      },
      async enqueueSupervisor(run) {
        enqueued.push(run.runId);
        return { runId: run.runId, graphileJobId: "graphile_supervisor_1" };
      },
    },
  );

  const result = await product.createMentionRun({
    userId: "user_1",
    userCommand: "@Cassie get me in",
    sourcePost,
  });

  expect(result.status).toBe("queued");
  expect(enqueued).toEqual([result.runId]);
  expect((await store.load()).tradeTickets).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/control-plane.test.ts`

Expected: FAIL because `createMentionRun` and `enqueueSupervisor` do not exist.

- [ ] **Step 3: Split queue interface**

In `src/jobs/execution-jobs.ts`, rename `ExecutionJobQueue` to `CassieJobQueue` and give it two methods:

```ts
export interface CassieJobQueue {
  enqueueExecution(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }>;
  enqueueSupervisor(run: ControlRun): Promise<{ runId: string; graphileJobId: string | null }>;
}
```

Keep the execution task name and add:

```ts
export const RUN_CASSIE_SUPERVISOR_TASK = "run_cassie_supervisor";
```

Add `enqueueSupervisor(run)` to the Graphile queue with:

```ts
await workerUtils.addJob(
  RUN_CASSIE_SUPERVISOR_TASK,
  { runId: run.runId },
  {
    jobKey: `cassie:run:${run.runId}`,
    jobKeyMode: "unsafe_dedupe",
    queueName: `cassie:run:${run.runId}`,
    maxAttempts: Number(process.env.GRAPHILE_SUPERVISOR_MAX_ATTEMPTS ?? 3),
  },
);
```

- [ ] **Step 4: Add product intake method**

In `src/product.ts`, add:

```ts
async createMentionRun(input: {
  userId: string;
  userCommand: string;
  sourcePost: SourcePost;
}): Promise<{ runId: string; status: ControlRun["status"] }> {
  const userSettings = await this.store.getUserSettings(input.userId);
  if (!userSettings) {
    throw new Error(`No Cassie settings found for user ${input.userId}.`);
  }

  await this.store.addMention(input);
  const run = await this.store.createRun(input);
  await this.store.addRunStep({
    runId: run.runId,
    stepType: "intake",
    status: "succeeded",
    input,
    output: { queued: true },
    error: null,
    model: null,
    promptName: null,
    promptVersion: null,
    completedAt: new Date().toISOString(),
  });
  await this.jobQueue.enqueueSupervisor(run);
  return { runId: run.runId, status: run.status };
}
```

Keep `processMention()` for compatibility until Task 6 removes or narrows it.

- [ ] **Step 5: Change `/api/mentions` response**

In `src/server.ts`, change the `/api/mentions` handler to:

```ts
const body = MentionRequestSchema.parse(await readJson(request));
sendJson(response, 202, await product.createMentionRun(body));
return;
```

- [ ] **Step 6: Run tests and build**

Run: `npm test -- tests/control-plane.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/jobs/execution-jobs.ts src/product.ts src/server.ts tests/control-plane.test.ts
git commit -m "feat: queue cassie supervisor runs"
```

## Task 3: AI SDK Supervisor Tool Loop

**Files:**
- Create: `src/supervisor/tools.ts`
- Create: `src/supervisor/agent.ts`
- Create: `src/supervisor/steps.ts`
- Modify: `src/jobs/execution-jobs.ts`
- Test: `tests/supervisor-agent.test.ts`

- [ ] **Step 1: Write failing supervisor agent test**

Create `tests/supervisor-agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../src/store.ts";
import { runCassieSupervisorForRun } from "../src/supervisor/agent.ts";

describe("AI SDK supervisor agent", () => {
  it("records bounded tool steps and creates a pending trade ticket", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: null,
        authorHandle: "example",
        authorName: "Example",
        text: "Solana ETF approval is basically inevitable now. Market is asleep.",
        createdAt: null,
      },
    });

    await runCassieSupervisorForRun({
      runId: run.runId,
      store,
      testMode: "deterministic",
    });

    const state = await store.load();
    expect(state.tradeTickets[0]?.approvalState).toBe("pending");
    expect(state.runSteps.map((step) => step.stepType)).toEqual(
      expect.arrayContaining(["intent", "thesis", "research", "market_selection", "risk", "ticket", "final"]),
    );
    expect(state.executionJobs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/supervisor-agent.test.ts`

Expected: FAIL because `runCassieSupervisorForRun` does not exist.

- [ ] **Step 3: Add step recorder helpers**

Create `src/supervisor/steps.ts`:

```ts
import type { CassieStore } from "../store.ts";
import type { RunStep, RunStepType } from "../schemas.ts";

export async function recordRunStep<T>(input: {
  store: CassieStore;
  runId: string;
  stepType: RunStepType;
  promptName?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  stepInput: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
  const started = await input.store.addRunStep({
    runId: input.runId,
    stepType: input.stepType,
    status: "running",
    input: input.stepInput,
    output: null,
    error: null,
    model: input.model ?? null,
    promptName: input.promptName ?? null,
    promptVersion: input.promptVersion ?? null,
    completedAt: null,
  });

  try {
    const output = await input.execute();
    await input.store.updateRunStep({
      ...started,
      status: "succeeded",
      output,
      completedAt: new Date().toISOString(),
    });
    return output;
  } catch (error) {
    await input.store.updateRunStep({
      ...started,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export function isStepType(value: string): value is RunStep["stepType"] {
  return [
    "intake",
    "intent",
    "thesis",
    "inverse_thesis",
    "research",
    "critique",
    "market_candidates",
    "market_selection",
    "risk",
    "ticket",
    "final",
  ].includes(value);
}
```

- [ ] **Step 4: Add AI SDK tools**

Create `src/supervisor/tools.ts`. Wrap existing tool functions with `tool({ description, inputSchema, execute })`. Include these tools:

```ts
export function createCassieSupervisorTools(input: {
  store: CassieStore;
  deps: CassieDependencies;
  run: ControlRun;
  userSettings: UserSettings;
  accountState: AccountState;
}) {
  return {
    classify_intent: tool({
      description: "Classify the user's Cassie command into think, critic, trade, or countertrade.",
      inputSchema: z.object({}),
      execute: async () => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "intent",
        promptName: "cassie_intent",
        promptVersion: "2026-05-20",
        model: process.env.CASSIE_MODEL ?? "gpt-5.5",
        stepInput: { userCommand: input.run.userCommand, sourcePost: input.run.sourcePost },
        execute: () => routeIntent({
          ai: input.deps.ai,
          userCommand: input.run.userCommand,
          sourcePost: input.run.sourcePost,
        }),
      }),
    }),
    extract_thesis: tool({
      description: "Extract the market thesis from the source post and command.",
      inputSchema: z.object({}),
      execute: async () => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "thesis",
        promptName: "cassie_thesis",
        promptVersion: "2026-05-20",
        model: process.env.CASSIE_MODEL ?? "gpt-5.5",
        stepInput: { userCommand: input.run.userCommand, sourcePost: input.run.sourcePost },
        execute: () => extractThesis({
          ai: input.deps.ai,
          userCommand: input.run.userCommand,
          sourcePost: input.run.sourcePost,
        }),
      }),
    }),
  };
}
```

Add the remaining tools in the same file with explicit descriptions and input schemas:

```ts
research_thesis: inputSchema z.object({ thesis: ThesisSchema, researchAngle: z.enum(["balanced", "critic", "counter"]) })
extract_inverse_thesis: inputSchema z.object({ thesis: ThesisSchema })
critique_thesis: inputSchema z.object({ thesis: ThesisSchema, researchReport: ResearchReportSchema })
select_market: inputSchema z.object({ thesis: ThesisSchema, researchReport: ResearchReportSchema.optional() })
risk_check: inputSchema z.object({ marketSelection: MarketSelectionSchema, sizeUsd: z.number().positive().nullable().optional() })
create_trade_ticket: inputSchema z.object({ thesis: ThesisSchema, marketSelection: MarketSelectionSchema, riskDecision: RiskDecisionSchema, sizeUsd: z.number().positive().nullable().optional() })
finalize_run: inputSchema z.object({ responseType: z.enum(["analysis", "critique", "trade_ticket"]), result: z.unknown() })
```

The `create_trade_ticket` tool must throw if `riskDecision.decision === "reject"` and must not enqueue execution.

- [ ] **Step 5: Add supervisor agent**

Create `src/supervisor/agent.ts`:

```ts
import { generateText, stepCountIs, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createCassieSupervisorTools } from "./tools.ts";

export async function runCassieSupervisorForRun(input: {
  runId: string;
  store?: CassieStore;
  deps?: CassieDependencies;
  accountStateProvider?: AccountStateProvider;
  testMode?: "deterministic";
}) {
  const store = input.store ?? new DrizzleCassieStore();
  const run = await store.getRun(input.runId);
  if (!run) throw new Error(`Run ${input.runId} was not found.`);

  const userSettings = await store.getUserSettings(run.userId);
  if (!userSettings) throw new Error(`No Cassie settings found for user ${run.userId}.`);

  const deps = input.deps ?? {
    ai: new OpenAiStructuredClient(),
    marketData: new CompositeMarketDataProvider(),
    researchLanes: new LiveResearchSearchLanes(),
  };
  const accountState = await (input.accountStateProvider ?? new HyperliquidAccountStateProvider())
    .getAccountState(userSettings);

  const tools = createCassieSupervisorTools({ store, deps, run, userSettings, accountState });

  if (input.testMode === "deterministic") {
    return runDeterministicSupervisorFixture({ store, deps, run, userSettings, accountState });
  }

  const result = await generateText({
    model: openai(process.env.CASSIE_SUPERVISOR_MODEL ?? process.env.CASSIE_MODEL ?? "gpt-5.5"),
    stopWhen: stepCountIs(Number(process.env.CASSIE_SUPERVISOR_MAX_STEPS ?? 12)),
    tools,
    prompt: buildSupervisorPrompt(run),
  });

  await store.updateRun({
    ...run,
    status: "succeeded",
    result: { text: result.text, steps: result.steps.length },
    updatedAt: new Date().toISOString(),
  });

  return result;
}
```

The prompt must tell the supervisor to use tools, stop before execution, and call `finalize_run` when complete.

- [ ] **Step 6: Wire supervisor task**

In `src/jobs/execution-jobs.ts`, add `RUN_CASSIE_SUPERVISOR_TASK` to `createExecutionTaskList()`:

```ts
[RUN_CASSIE_SUPERVISOR_TASK]: async (payload) => {
  const parsed = z.object({ runId: z.string() }).parse(payload);
  await runCassieSupervisorForRun({ runId: parsed.runId });
},
```

- [ ] **Step 7: Run tests and build**

Run: `npm test -- tests/supervisor-agent.test.ts tests/control-plane.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/supervisor src/jobs/execution-jobs.ts tests/supervisor-agent.test.ts
git commit -m "feat: add cassie ai sdk supervisor"
```

## Task 4: Research Subagent As Durable Tool

**Files:**
- Modify: `src/tools/research.ts`
- Modify: `src/connectors/research-lanes.ts`
- Test: `tests/cassie.test.ts`
- Test: `tests/connectors.test.ts`

- [ ] **Step 1: Write failing partial-lane warning test**

Add to `tests/cassie.test.ts`:

```ts
it("marks research as insufficient when both search lanes fail", async () => {
  await expect(researchThesis({
    ai: new FakeAi("trade"),
    lanes: {
      async runOpenAiWebSearch() { throw new Error("openai search down"); },
      async runGrokXSearch() { throw new Error("x search down"); },
    },
    sourcePost,
    userCommand: "@Cassie is this real?",
    thesis,
    researchAngle: "balanced",
  })).resolves.toMatchObject({
    recommendedResearchAction: "insufficient_research",
    warnings: expect.arrayContaining(["OPENAI_SEARCH_FAILED", "X_SEARCH_FAILED"]),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/cassie.test.ts`

Expected: FAIL because lane failures are passed as raw settled payloads and the fake AI can ignore warning requirements.

- [ ] **Step 3: Normalize lane failure warnings before synthesis**

In `src/tools/research.ts`, add:

```ts
const warnings = [
  openAiResult.status === "rejected" ? "OPENAI_SEARCH_FAILED" : null,
  xResult.status === "rejected" ? "X_SEARCH_FAILED" : null,
].filter((warning): warning is ResearchWarning => Boolean(warning));

if (openAiResult.status === "rejected" && xResult.status === "rejected") {
  return {
    claim: input.thesis.claim,
    normalizedThesis: input.thesis.claim,
    stance: "unclear",
    evidenceQuality: "insufficient",
    socialContext: {
      momentum: "unknown",
      crowdingSignal: "unknown",
      manipulationSignal: "unknown",
      summary: "Both research lanes failed.",
    },
    bullCase: [],
    bearCase: [],
    contradictions: [],
    evidence: [],
    warnings,
    confidence: 0,
    researchConclusion: "insufficient_research",
    recommendedResearchAction: "insufficient_research",
    publicSummary: "Cassie could not gather enough evidence to evaluate this claim.",
    fullResearchBrief: "OpenAI web search and Grok X search both failed, so Cassie cannot verify the thesis.",
  };
}
```

Pass `warnings` into the synthesis prompt for partial failures and require the output warnings to include them.

- [ ] **Step 4: Run tests and build**

Run: `npm test -- tests/cassie.test.ts tests/connectors.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/research.ts tests/cassie.test.ts tests/connectors.test.ts
git commit -m "fix: make research lane failures explicit"
```

## Task 5: Run Inspection API

**Files:**
- Modify: `src/server.ts`
- Modify: `src/product.ts`
- Test: `tests/product.test.ts`

- [ ] **Step 1: Add product methods**

In `src/product.ts`, add:

```ts
async getRun(runId: string) {
  const run = await this.store.getRun(runId);
  if (!run) throw new Error(`Run ${runId} was not found.`);
  return {
    run,
    steps: await this.store.getRunSteps(runId),
  };
}
```

- [ ] **Step 2: Add server routes**

In `src/server.ts`, add before the ticket route:

```ts
const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
if (request.method === "GET" && runMatch) {
  requireApiToken(request);
  sendJson(response, 200, await product.getRun(runMatch[1] as string));
  return;
}

const runStepsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/steps$/);
if (request.method === "GET" && runStepsMatch) {
  requireApiToken(request);
  sendJson(response, 200, {
    steps: await product.getRun(runStepsMatch[1] as string).then((result) => result.steps),
  });
  return;
}
```

- [ ] **Step 3: Run product/server tests**

Run: `npm test -- tests/product.test.ts tests/control-plane.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/product.ts src/server.ts tests/product.test.ts
git commit -m "feat: expose run inspection api"
```

## Task 6: Execution Boundary And Preflight

**Files:**
- Modify: `src/product.ts`
- Modify: `src/jobs/execution-jobs.ts`
- Modify: `src/execution.ts`
- Test: `tests/product.test.ts`

- [ ] **Step 1: Write failing execution preflight test**

Add to `tests/product.test.ts`:

```ts
it("rechecks account state before execution", async () => {
  const store = new InMemoryCassieStore();
  const ticket = await store.addTradeTicket({
    ticketId: "ticket_1",
    userId: "user_1",
    thesis: "SOL may rally.",
    venue: "hyperliquid",
    instrument: "perp",
    side: "long",
    sizeUsd: 50,
    orderType: "marketable_limit",
    venueData: { symbol: "SOL", spreadBps: 10, estimatedSlippageBps: 10, minOrderSizeUsd: 10 },
    riskDecision: { decision: "require_approval", reason: "Auto-trade is disabled." },
    approvalState: "approved",
  });
  await store.addExecutionJob(createQueuedExecutionJob(ticket.ticketId));

  await expect(executeExecutionJob({
    jobId: (await store.load()).executionJobs[0]!.jobId,
    store,
    executionClient: new FakeExecutionClient(),
    accountStateProvider: new StaticAccountStateProvider({
      userId: "user_1",
      availableBalanceUsd: 1,
      openExposureUsd: 0,
      dailyLossUsd: 0,
      openOrdersUsd: 0,
    }),
  })).rejects.toThrow("Insufficient available balance");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/product.test.ts`

Expected: FAIL because `executeExecutionJob` does not accept `accountStateProvider` or rerun risk.

- [ ] **Step 3: Add execution preflight**

In `src/jobs/execution-jobs.ts`, extend `executeExecutionJob` input with `accountStateProvider?: AccountStateProvider`. Before `executionClient.execute(ticket)`, load user settings, get fresh account state, and call `evaluateRisk()` with the ticket's market-shaped data:

```ts
const settings = await store.getUserSettings(ticket.userId);
if (!settings) throw new Error(`No Cassie settings found for user ${ticket.userId}.`);
const accountState = await (input.accountStateProvider ?? new HyperliquidAccountStateProvider())
  .getAccountState(settings);
const preflight = evaluateRisk({
  userSettings: settings,
  accountState,
  sizeUsd: ticket.sizeUsd,
  marketSelection: {
    selectedMarket: ticketToMarketCandidate(ticket),
    rejectedCandidates: [],
    noTradeReason: null,
  },
});
if (preflight.decision === "reject") {
  throw new Error(preflight.reason);
}
```

Add `ticketToMarketCandidate(ticket)` in the same file or a small helper file.

- [ ] **Step 4: Run tests and build**

Run: `npm test -- tests/product.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/execution-jobs.ts src/execution.ts tests/product.test.ts
git commit -m "feat: add execution preflight risk check"
```

## Task 7: Documentation And Migration Notes

**Files:**
- Modify: `README.md`
- Modify: `architecture.md`
- Modify: `research-subagent.md`

- [ ] **Step 1: Update README API behavior**

Change the mention section to show `202 Accepted` and:

```json
{
  "runId": "RUN_ID",
  "status": "queued"
}
```

Add run inspection examples:

```bash
curl http://localhost:3000/api/runs/RUN_ID \
  -H "Authorization: Bearer $CASSIE_API_TOKEN"

curl http://localhost:3000/api/runs/RUN_ID/steps \
  -H "Authorization: Bearer $CASSIE_API_TOKEN"
```

- [ ] **Step 2: Update architecture docs**

In `architecture.md`, replace the synchronous flow with:

```text
X/API mention
-> create CassieRun
-> enqueue supervisor workflow
-> AI SDK tool loop
-> bounded tools
-> deterministic risk
-> trade ticket
-> approval
-> execution worker
-> receipt
```

Keep the existing no-direct-`place-order` rule.

- [ ] **Step 3: Update research-subagent docs**

In `research-subagent.md`, clarify that `researchThesis()` is called as an AI SDK supervisor tool and internally runs deterministic search-lane workflow plus structured LLM synthesis.

- [ ] **Step 4: Run verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md architecture.md research-subagent.md
git commit -m "docs: document cassie control plane architecture"
```

## Self-Review

- Spec coverage: This plan covers the requested control-plane/tool-loop architecture, API-only surface, durable run state, research subagent boundary, deterministic risk, and separate execution workflow.
- Placeholder scan: No placeholder markers or unspecified edge-handling steps are present.
- Type consistency: The plan consistently uses `ControlRun`, `RunStep`, `CassieJobQueue`, `runCassieSupervisorForRun`, and existing Cassie domain schemas.
- Scope check: The dashboard is intentionally excluded. This plan produces a testable API/worker control plane without adding UI.
