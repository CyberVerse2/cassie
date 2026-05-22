# Flexible Cassie Agent Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cassie's fixed supervisor sequence with a dynamic governed tool loop that can branch, revisit, and finalize flexibly while preserving market, risk, and ticket safety.

**Architecture:** Keep the existing supervisor tools, persisted run-step model, audit logging, and execution boundary. Replace fixed `selectActiveTools` sequencing with state-derived tool availability and add validators so risky tools and final results are allowed only when canonical persisted prerequisites exist.

**Tech Stack:** TypeScript, AI SDK `ToolLoopAgent`, Vitest, Zod schemas, existing `CassieStore` and `InMemoryCassieStore`.

---

## File Structure

- Modify `packages/ai/agents/supervisor/policy.ts`: replace fixed sequence selection with dynamic state-aware active tool selection, keep message compression, and export small helpers for tests.
- Modify `packages/ai/agents/supervisor/tools.ts`: add tool-level prerequisite validation for market selection, risk checks, trade tickets, and finalization modes; keep explicit watch requests represented as `analysis` results with `action: "watchlist"` because `SupervisorFinalResultSchema` currently does not expose a separate `watch` response type.
- Modify `packages/ai/agents/supervisor/agent.ts`: update supervisor instructions so the model understands the flexible loop, no-follow-up requirement, conservative ambiguity handling, and guarded finalization.
- Modify `tests/supervisor-agent.test.ts`: add unit tests for tool prerequisite validators and finalization behavior using existing fixtures.
- Create `tests/supervisor-policy.test.ts`: focused tests for dynamic active-tool exposure without pulling in tool execution fixtures.
- Run `npm test -- supervisor-policy supervisor-agent` and `npm run build`.

## Task 1: Dynamic Policy Tests

**Files:**
- Create: `tests/supervisor-policy.test.ts`
- Modify: `packages/ai/agents/supervisor/policy.ts`

- [ ] **Step 1: Write failing tests for flexible active tools**

Create `tests/supervisor-policy.test.ts` with these tests:

```ts
import { describe, expect, it } from "vitest";
import { selectActiveTools } from "../packages/ai/agents/supervisor/policy.ts";

function stepWithTool(toolName: string, output: unknown = {}) {
  return {
    toolCalls: [{ toolName }],
    toolResults: [{ toolName, output }],
  } as never;
}

const tradeExpression = {
  decision: "route_to_market_router",
  candidates: [{ tradableNow: true }],
  highestPurityExpression: "Long SOL perp.",
  marketRouterInstructions: "Prefer direct SOL perps.",
};

const noTradeExpression = {
  decision: "no_trade",
  candidates: [],
  highestPurityExpression: "No clean expression.",
  marketRouterInstructions: null,
};

describe("dynamic supervisor tool policy", () => {
  it("starts with broad analytical tools instead of a single fixed first tool", () => {
    expect(selectActiveTools([])).toEqual([
      "classify_intent",
      "interpret_signal",
      "extract_thesis",
      "finalize_run",
    ]);
  });

  it("allows research, critique, trade planning, and finalization after thesis context exists", () => {
    expect(selectActiveTools([
      stepWithTool("classify_intent", { intent: "trade" }),
      stepWithTool("interpret_signal"),
      stepWithTool("extract_thesis"),
    ])).toEqual(expect.arrayContaining([
      "research_thesis",
      "critique_thesis",
      "plan_trade_expression",
      "finalize_run",
    ]));
  });

  it("unlocks market tools after a tradable expression exists", () => {
    expect(selectActiveTools([
      stepWithTool("extract_thesis"),
      stepWithTool("research_thesis"),
      stepWithTool("plan_trade_expression", tradeExpression),
    ])).toEqual(expect.arrayContaining([
      "find_polymarket_markets",
      "select_market",
      "finalize_run",
    ]));
  });

  it("does not unlock risk or ticket tools until market selection and risk prerequisites exist", () => {
    expect(selectActiveTools([
      stepWithTool("extract_thesis"),
      stepWithTool("research_thesis"),
      stepWithTool("plan_trade_expression", tradeExpression),
    ])).not.toEqual(expect.arrayContaining(["risk_check", "create_trade_ticket"]));

    expect(selectActiveTools([
      stepWithTool("extract_thesis"),
      stepWithTool("research_thesis"),
      stepWithTool("plan_trade_expression", tradeExpression),
      stepWithTool("select_market", { selectedMarket: { symbol: "SOL" }, noTradeReason: null }),
    ])).toEqual(expect.arrayContaining(["risk_check"]));

    expect(selectActiveTools([
      stepWithTool("extract_thesis"),
      stepWithTool("research_thesis"),
      stepWithTool("plan_trade_expression", tradeExpression),
      stepWithTool("select_market", { selectedMarket: { symbol: "SOL" }, noTradeReason: null }),
      stepWithTool("risk_check", { decision: "approve" }),
    ])).toEqual(expect.arrayContaining(["create_trade_ticket"]));
  });

  it("keeps finalization available for no-trade analysis without risk or ticket tools", () => {
    const activeTools = selectActiveTools([
      stepWithTool("extract_thesis"),
      stepWithTool("research_thesis"),
      stepWithTool("plan_trade_expression", noTradeExpression),
    ]);

    expect(activeTools).toContain("finalize_run");
    expect(activeTools).not.toContain("risk_check");
    expect(activeTools).not.toContain("create_trade_ticket");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/supervisor-policy.test.ts
```

Expected: fail because the current `selectActiveTools([])` returns only `["classify_intent"]` and later states still follow the fixed sequence.

- [ ] **Step 3: Implement dynamic active-tool selection**

In `packages/ai/agents/supervisor/policy.ts`, replace the body of `selectActiveTools` with state-derived availability. Keep existing helper names where possible:

```ts
export function selectActiveTools(
  steps: Array<Pick<StepResult<ToolSet>, "toolCalls" | "toolResults">>,
): CassieSupervisorToolName[] {
  if (hasSucceeded(steps, "finalize_run")) {
    return [];
  }

  const active = new Set<CassieSupervisorToolName>();
  const intent = getLatestToolOutput<IntentResult>(steps, "classify_intent")?.intent;
  const expression = getLatestToolOutput<TradeExpressionPlan>(steps, "plan_trade_expression");
  const riskDecision = getLatestToolOutput<RiskDecision>(steps, "risk_check");

  if (!hasSucceeded(steps, "classify_intent")) active.add("classify_intent");
  if (!hasSucceeded(steps, "interpret_signal")) active.add("interpret_signal");
  if (!hasSucceeded(steps, "extract_thesis")) active.add("extract_thesis");

  if (intent === "countertrade" && !hasSucceeded(steps, "extract_inverse_thesis")) {
    active.add("extract_inverse_thesis");
  }

  if (hasSucceeded(steps, "extract_thesis")) {
    if (!hasSucceeded(steps, "research_thesis")) active.add("research_thesis");
    active.add("plan_trade_expression");
  }

  if (hasSucceeded(steps, "research_thesis")) {
    active.add("critique_thesis");
    active.add("plan_trade_expression");
  }

  if (expression && shouldRouteToMarket(expression)) {
    const nextMarketTool = selectNextMarketTool(steps, expression);
    if (nextMarketTool) active.add(nextMarketTool);
    active.add("select_market");
  }

  if (hasUsableMarketSelection(steps) && !hasSucceeded(steps, "risk_check")) {
    active.add("risk_check");
  }

  if (
    riskDecision &&
    riskDecision.decision !== "reject" &&
    !hasSucceeded(steps, "create_trade_ticket")
  ) {
    active.add("create_trade_ticket");
  }

  active.add("finalize_run");

  return orderedTools(active);
}

function orderedTools(active: Set<CassieSupervisorToolName>): CassieSupervisorToolName[] {
  const order: CassieSupervisorToolName[] = [
    "classify_intent",
    "interpret_signal",
    "extract_thesis",
    "extract_inverse_thesis",
    "research_thesis",
    "critique_thesis",
    "plan_trade_expression",
    "find_polymarket_markets",
    "select_market",
    "risk_check",
    "create_trade_ticket",
    "finalize_run",
  ];
  return order.filter((toolName) => active.has(toolName));
}
```

Add this helper near `getLatestToolOutput`:

```ts
function hasUsableMarketSelection(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
): boolean {
  const selection = getLatestToolOutput<{ selectedMarket?: unknown; noTradeReason?: unknown }>(steps, "select_market");
  return Boolean(selection?.selectedMarket) && !selection?.noTradeReason;
}
```

- [ ] **Step 4: Run policy tests**

Run:

```bash
npm test -- tests/supervisor-policy.test.ts
```

Expected: all tests in `tests/supervisor-policy.test.ts` pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/ai/agents/supervisor/policy.ts tests/supervisor-policy.test.ts
git commit -m "feat: make supervisor tool policy dynamic"
```

## Task 2: Tool Prerequisite Validators

**Files:**
- Modify: `packages/ai/agents/supervisor/tools.ts`
- Modify: `tests/supervisor-agent.test.ts`

- [ ] **Step 1: Add failing tests for risky tool prerequisites**

Append these tests inside the existing `describe("AI SDK supervisor agent", () => { ... })` block in `tests/supervisor-agent.test.ts`:

```ts
  it("rejects risk checks without a persisted usable market selection", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });
    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      accountState: {
        userId: "user_1",
        availableBalanceUsd: 500,
        openExposureUsd: 0,
        dailyLossUsd: 0,
        openOrdersUsd: 0,
      },
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    await expect(executeTool(tools.risk_check, {
      marketSelection,
      sizeUsd: null,
    })).rejects.toThrow("Risk check requires a persisted usable market selection.");
  });

  it("rejects trade ticket creation without a persisted non-rejected risk decision", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });
    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    await expect(executeTool(tools.create_trade_ticket, {
      thesis,
      marketSelection,
      riskDecision: { decision: "approve", adjustedSizeUsd: 50 },
      sizeUsd: null,
    })).rejects.toThrow("Trade ticket creation requires a persisted non-rejected risk decision.");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/supervisor-agent.test.ts
```

Expected: both new tests fail because current tool execution can use model-provided inputs when no canonical persisted risk/market state exists.

- [ ] **Step 3: Add prerequisite helpers and validations**

In `packages/ai/agents/supervisor/tools.ts`, add these helpers near `tryCanonicalStepOutput`:

```ts
async function requireCanonicalStepOutput<T>(
  store: CassieStore,
  runId: string,
  stepType: RunStepType,
  schema: z.ZodType<T>,
  message: string,
): Promise<T> {
  const output = await tryCanonicalStepOutput<T>(store, runId, stepType, schema);
  if (output == null) {
    throw new Error(message);
  }
  return output;
}

function assertUsableMarketSelection(selection: MarketSelection): void {
  if (!selection.selectedMarket || selection.noTradeReason) {
    throw new Error("Risk check requires a persisted usable market selection.");
  }
}

function assertNonRejectedRiskDecision(decision: RiskDecision): void {
  if (decision.decision === "reject") {
    throw new Error("Trade ticket creation requires a persisted non-rejected risk decision.");
  }
}
```

Then change `risk_check` to require persisted market selection instead of falling back to model input:

```ts
const canonicalMarketSelection = await requireCanonicalStepOutput(
  input.store,
  input.run.runId,
  "market_selection",
  MarketSelectionSchema,
  "Risk check requires a persisted usable market selection.",
);
assertUsableMarketSelection(canonicalMarketSelection);
```

Change `create_trade_ticket` to require persisted thesis, market selection, and risk:

```ts
const canonicalThesis = await requireCanonicalStepOutput(
  input.store,
  input.run.runId,
  "thesis",
  ThesisSchema,
  "Trade ticket creation requires a persisted thesis.",
);
const canonicalMarketSelection = await requireCanonicalStepOutput(
  input.store,
  input.run.runId,
  "market_selection",
  MarketSelectionSchema,
  "Trade ticket creation requires a persisted usable market selection.",
);
assertUsableMarketSelection(canonicalMarketSelection);
const canonicalRiskDecision = await requireCanonicalStepOutput(
  input.store,
  input.run.runId,
  "risk",
  RiskDecisionSchema,
  "Trade ticket creation requires a persisted non-rejected risk decision.",
);
assertNonRejectedRiskDecision(canonicalRiskDecision);
```

- [ ] **Step 4: Run supervisor-agent tests**

Run:

```bash
npm test -- tests/supervisor-agent.test.ts
```

Expected: all supervisor-agent tests pass. If the existing "does not require account state before tools need risk evaluation" test now fails earlier with the persisted-market error, update that test to persist `select_market` before asserting that `risk_check` hits the account-state provider.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/ai/agents/supervisor/tools.ts tests/supervisor-agent.test.ts
git commit -m "feat: guard supervisor risky tools"
```

## Task 3: Flexible Finalization Modes and Validation

**Files:**
- Modify: `packages/ai/agents/supervisor/tools.ts`
- Modify: `tests/supervisor-agent.test.ts`

- [ ] **Step 1: Add failing tests for no-trade and trade-ticket finalization**

Append these tests inside the supervisor-agent describe block:

```ts
  it("allows early grounded analysis finalization without market or risk state", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie analyze this",
      sourcePost,
    });
    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    const extracted = await executeTool<Thesis>(tools.extract_thesis, { signal });
    const report = await executeTool<ResearchReport>(tools.research_thesis, {
      signal,
      thesis: extracted,
      researchAngle: "balanced",
    });

    await expect(executeTool(tools.finalize_run, {
      responseType: "analysis",
      publicSummary: "No clean trade yet; evidence remains capped.",
      thesis: extracted,
      researchReport: report,
    })).resolves.toMatchObject({
      responseType: "analysis",
      publicSummary: expect.stringContaining("No clean trade"),
    });
  });

  it("rejects trade-ticket finalization without a persisted ticket", async () => {
    const store = new InMemoryCassieStore();
    const run = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie get me in",
      sourcePost,
    });
    const tools = createCassieSupervisorTools({
      store,
      run,
      userSettings: settings,
      deps: {
        ai: new FakeAi(),
        marketData: {
          async findCandidates() {
            return [marketSelection.selectedMarket!];
          },
        },
        researchLanes: {
          async runOpenAiQueryJob() {
            return { lane: "openai_search" as const, evidence: [], warnings: [] };
          },
          async runGrokXQueryJob() {
            return { lane: "x_search" as const, evidence: [], warnings: [] };
          },
        },
      },
    });

    await expect(executeTool(tools.finalize_run, {
      responseType: "trade_ticket",
      publicSummary: "Created a ticket.",
      tradeTicket: { ticketId: "missing_ticket" },
    })).rejects.toThrow("Trade-ticket finalization requires a persisted trade ticket.");
  });
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
npm test -- tests/supervisor-agent.test.ts
```

Expected: the trade-ticket validation test should fail if current validation accepts a non-persisted ticket id or gives a less precise error. The early analysis test should pass or reveal where current finalization is still too strict.

- [ ] **Step 3: Harden `validateFinalizationPrerequisites`**

In `packages/ai/agents/supervisor/tools.ts`, update `validateFinalizationPrerequisites` so it enforces:

```ts
if (input.responseType === "trade_ticket") {
  const persistedTicket = await tryCanonicalStepOutput<TradeTicket>(
    store,
    runId,
    "ticket",
    TradeTicketSchema,
  );
  if (!persistedTicket || input.tradeTicket?.ticketId !== persistedTicket.ticketId) {
    throw new Error("Trade-ticket finalization requires a persisted trade ticket.");
  }
  const riskDecision = await requireCanonicalStepOutput(
    store,
    runId,
    "risk",
    RiskDecisionSchema,
    "Trade-ticket finalization requires a persisted non-rejected risk decision.",
  );
  assertNonRejectedRiskDecision(riskDecision);
}
```

Keep analysis and critique permissive enough to finalize from persisted thesis, research, critique, or trade-expression context. Do not require market or risk state for non-ticket finalization.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/supervisor-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/ai/agents/supervisor/tools.ts tests/supervisor-agent.test.ts
git commit -m "feat: validate flexible supervisor finalization"
```

## Task 4: Supervisor Instructions

**Files:**
- Modify: `packages/ai/agents/supervisor/agent.ts`
- Test: `tests/prompts.test.ts` or create a focused assertion in `tests/supervisor-agent.test.ts`

- [ ] **Step 1: Add a prompt/instruction test**

If `tests/prompts.test.ts` already imports prompt builders, add this test there. If not, export `buildSupervisorInstructions` from `packages/ai/agents/supervisor/agent.ts` and add this test to `tests/supervisor-agent.test.ts`:

```ts
import { buildSupervisorInstructions } from "../packages/ai/agents/supervisor/agent.ts";

it("instructs the supervisor to use a flexible governed loop", () => {
  const instructions = buildSupervisorInstructions();

  expect(instructions).toContain("You may choose tools dynamically");
  expect(instructions).toContain("Do not ask the user follow-up questions mid-run");
  expect(instructions).toContain("Treat ambiguity conservatively");
  expect(instructions).toContain("Never invent market candidates, prices, account state, or risk approvals");
  expect(instructions).toContain("Always use finalize_run");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/supervisor-agent.test.ts
```

Expected: fail because `buildSupervisorInstructions` is not exported or does not contain the new flexible-loop language.

- [ ] **Step 3: Update instructions**

In `packages/ai/agents/supervisor/agent.ts`, export `buildSupervisorInstructions` and replace the current instruction text with:

```ts
export function buildSupervisorInstructions(): string {
  return `You are Cassie's supervisor agent.

Use the available tools as a flexible governed loop. You may choose tools dynamically, revisit analysis, branch into research, inspect markets, critique the thesis, or finalize when the best grounded result is clear.

Safety and behavior:
- Do not ask the user follow-up questions mid-run.
- Treat ambiguity conservatively and explain the conservative choice in the final result.
- Do not execute orders, place orders, or enqueue execution.
- A trade ticket is only a proposed/actionable ticket, not an executed trade.
- Never invent market candidates, prices, account state, or risk approvals.
- Ground every decision and summary in tool outputs.
- If risk_check rejects a proposal, finalize with analysis and the rejection reason; do not present the trade as approved.
- Watchlist behavior is valid only for explicit watch requests.
- Do not silently replace AI classification, routing, ranking, matching, or selection with keyword heuristics.

Tool-use guidance:
- Use research and critique tools when the claim needs evidence before a market decision.
- Use market tools only for real market discovery or selection.
- Use risk_check only after a real selected market exists.
- Use create_trade_ticket only after a non-rejected risk_check.
- Finalize with analysis or critique when evidence, market fit, or risk does not justify a ticket.

Final response requirements:
- Always use finalize_run for the final result.
- finalize_run.publicSummary must be concise, user-facing, and written like Cassie is answering the user.
- State the verdict, the reason, and the next action in plain market language.
- Do not copy enum values, tool names, step names, scores, or timeline-style labels into the summary.`;
}
```

- [ ] **Step 4: Run prompt test**

Run:

```bash
npm test -- tests/supervisor-agent.test.ts
```

Expected: prompt/instruction test passes.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/ai/agents/supervisor/agent.ts tests/supervisor-agent.test.ts
git commit -m "docs: guide flexible supervisor loop"
```

## Task 5: Full Verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/supervisor-policy.test.ts tests/supervisor-agent.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run build
```

Expected: TypeScript exits successfully with no errors.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional files are modified. Existing unrelated deletions may still appear if they were present before implementation; do not stage them unless the user explicitly asks.

- [ ] **Step 5: Commit any verification-only fixes**

If verification required small fixes, commit only those intentional files:

```bash
git add packages/ai/agents/supervisor/policy.ts packages/ai/agents/supervisor/tools.ts packages/ai/agents/supervisor/agent.ts tests/supervisor-policy.test.ts tests/supervisor-agent.test.ts
git commit -m "test: cover flexible supervisor workflow"
```

Expected: no commit is needed if Tasks 1-4 already committed all changes and verification produced no code changes.

## Self-Review

- Spec coverage: dynamic tool exposure is covered by Task 1; risky prerequisites and no invented/premature ticket state are covered by Tasks 2 and 3; no-follow-up and conservative ambiguity instructions are covered by Task 4; verification is covered by Task 5.
- Placeholder scan: this plan contains no placeholder markers or vague "add tests" instructions without concrete test code.
- Type consistency: plan uses existing tool names, schemas, `selectActiveTools`, `buildSupervisorInstructions`, `InMemoryCassieStore`, and `executeTool` patterns already present in the repo.
