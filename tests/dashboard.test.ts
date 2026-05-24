import { describe, expect, it } from "vitest";
import type { CassieStoreSnapshot } from "../packages/core/db/store.ts";
import { renderDashboard } from "../src/dashboard.ts";

const snapshot: CassieStoreSnapshot = {
  mentions: [],
  tradeTickets: [
    {
      ticketId: "ticket_1",
      runId: "run_1",
      userId: "user_1",
      thesis: "SOL ETF odds may rerate higher.",
      venue: "polymarket",
      instrument: "solana-etf-approved",
      side: "buy_yes",
      sizeUsd: 75,
      orderType: "marketable_limit",
      approvalState: "pending",
      riskDecision: {
        decision: "require_approval",
        reason: "User approval is required.",
      },
      venueData: {
        outcomeTokenId: "token_yes",
        spreadBps: 25,
      },
    },
  ],
  executionJobs: [
    {
      jobId: "job_1",
      ticketId: "ticket_1",
      status: "running",
      createdAt: "2026-05-23T10:04:00.000Z",
      updatedAt: "2026-05-23T10:05:00.000Z",
      failureReason: null,
      executionResult: null,
    },
  ],
  auditEvents: [
    {
      eventId: "audit_1",
      entityId: "job_1",
      entityType: "execution_job",
      eventType: "execution_job.created",
      message: "Execution job created.",
      data: { ticketId: "ticket_1" },
      createdAt: "2026-05-23T10:04:00.000Z",
    },
  ],
  userSettings: [],
  controlRuns: [
    {
      runId: "run_1",
      userId: "user_1",
      userCommand: "@Cassie get me SOL ETF exposure",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: "https://x.com/example/status/post_1",
        authorHandle: "example",
        authorName: "Example",
        text: "Solana ETF approval is basically inevitable now.",
        createdAt: "2026-05-23T10:00:00.000Z",
        quotedPostText: null,
        linkedUrls: [],
        mediaDescriptions: [],
      },
      status: "awaiting_approval",
      result: { actionState: "create_ticket", ticketId: "ticket_1" },
      error: null,
      createdAt: "2026-05-23T10:00:00.000Z",
      updatedAt: "2026-05-23T10:03:00.000Z",
    },
  ],
  runSteps: [
    {
      stepId: "step_1",
      runId: "run_1",
      stepType: "market_selection",
      status: "succeeded",
      input: null,
      output: { selectedMarket: "solana-etf-approved" },
      error: null,
      model: "deepseek-v4-pro",
      promptName: "cassie_market_selection",
      promptVersion: "2026-05-20",
      startedAt: "2026-05-23T10:02:00.000Z",
      completedAt: "2026-05-23T10:03:00.000Z",
    },
  ],
  modelCallUsage: [
    {
      id: "usage_1",
      controlRunId: "run_1",
      runStepId: "step_1",
      purpose: "market_selection",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      promptName: "cassie_market_selection",
      promptVersion: "2026-05-20",
      inputTokens: 120,
      outputTokens: 40,
      reasoningTokens: 80,
      cachedTokens: 30,
      totalTokens: 240,
      estimatedCostUsd: 0.0042,
      latencyMs: 930,
      status: "succeeded",
      error: null,
      createdAt: "2026-05-23T10:03:00.000Z",
    },
  ],
};

describe("dashboard", () => {
  it("renders admin observability for jobs, token spend, timeline, and run details", () => {
    const html = renderDashboard(snapshot);

    expect(html).toContain("Cassie Admin");
    expect(html).toContain("Token Spend");
    expect(html).toContain("240 tokens");
    expect(html).toContain("$0.0042");
    expect(html).toContain("Execution Jobs");
    expect(html).toContain("job_1");
    expect(html).toContain("running");
    expect(html).toContain("Timeline");
    expect(html).toContain("model.call");
    expect(html).toContain("@Cassie get me SOL ETF exposure");
    expect(html).toContain("market_selection");
    expect(html).toContain("cassie_market_selection");
  });

  it("wraps long step errors in a bounded error block", () => {
    const html = renderDashboard({
      ...snapshot,
      runSteps: [
        {
          ...snapshot.runSteps[0]!,
          status: "failed",
          error: `Structured AI failed: ${"schema mismatch ".repeat(80)}`,
        },
      ],
    });

    expect(html).toContain('class="step-error"');
    expect(html).toContain("Structured AI failed:");
  });

  it("renders thinking traces for run steps and model calls", () => {
    const html = renderDashboard({
      ...snapshot,
      runSteps: [
        {
          ...snapshot.runSteps[0]!,
          thinkingTrace: "The model selected the SOL ETF market because it matched the source post catalyst.",
        },
      ],
      modelCallUsage: [
        {
          ...snapshot.modelCallUsage[0]!,
          purpose: "supervisor_step",
          runStepId: null,
          promptName: "cassie_supervisor",
          thinkingTrace: "The supervisor decided to create an approval ticket after checking risk settings.",
        },
      ],
    });

    expect(html).toContain("Reasoning Summaries");
    expect(html).toContain('class="thinking-trace"');
    expect(html).toContain("market_selection");
    expect(html).toContain("The model selected the SOL ETF market");
    expect(html).toContain("supervisor_step");
    expect(html).toContain("The supervisor decided to create an approval ticket");
  });

  it("renders control-room filters, triage, spend analytics, waterfall, and actions", () => {
    const state: CassieStoreSnapshot = {
      ...snapshot,
      controlRuns: [
        ...snapshot.controlRuns,
        {
          ...snapshot.controlRuns[0]!,
          runId: "run_failed",
          status: "failed",
          error: "StructuredAiCallError: schema mismatch for candidates.venue",
          createdAt: "2026-05-23T11:00:00.000Z",
          updatedAt: "2026-05-23T11:03:00.000Z",
        },
      ],
      runSteps: [
        ...snapshot.runSteps,
        {
          ...snapshot.runSteps[0]!,
          stepId: "step_failed",
          runId: "run_failed",
          stepType: "trade_expression",
          status: "failed",
          error: "StructuredAiCallError: schema mismatch for candidates.venue",
          model: "gpt-5.4-mini",
          promptName: "cassie_trade_expressions",
          startedAt: "2026-05-23T11:01:00.000Z",
          completedAt: "2026-05-23T11:02:00.000Z",
        },
      ],
      modelCallUsage: [
        ...snapshot.modelCallUsage,
        {
          ...snapshot.modelCallUsage[0]!,
          id: "usage_failed",
          controlRunId: "run_failed",
          runStepId: "step_failed",
          purpose: "trade_expression",
          provider: "openai",
          model: "gpt-5.4-mini",
          promptName: "cassie_trade_expressions",
          inputTokens: 900,
          outputTokens: 100,
          reasoningTokens: 40,
          cachedTokens: 20,
          totalTokens: 1_040,
          status: "failed",
          error: "StructuredAiCallError: schema mismatch for candidates.venue",
          createdAt: "2026-05-23T11:02:00.000Z",
        },
      ],
    };

    const html = renderDashboard(state, {
      query: "schema",
      status: "failed",
      selectedRunId: "run_failed",
      refreshSeconds: 10,
    });

    expect(html).toContain("Attention Needed");
    expect(html).toContain("Run Search");
    expect(html).toContain('value="schema"');
    expect(html).toContain("Failure Triage");
    expect(html).toContain("StructuredAiCallError");
    expect(html).toContain("Spend by Model");
    expect(html).toContain("Spend by Prompt");
    expect(html).toContain("Run Waterfall");
    expect(html).toContain("Reasoning Summaries");
    expect(html).toContain('data-copy-value="run_failed"');
    expect(html).toContain("/dashboard/runs/run_failed.json");
    expect(html).toContain('http-equiv="refresh" content="10"');
    expect(html).toContain('data-run-status="failed"');
    expect(html).not.toContain('data-run-row="run_1"');
  });

  it("renders simplified dashboard layout affordances", () => {
    const html = renderDashboard({
      ...snapshot,
      runSteps: [
        {
          ...snapshot.runSteps[0]!,
          status: "failed",
          error: "StructuredAiCallError: schema mismatch",
        },
      ],
    });

    expect(html).toContain('class="dashboard-shell"');
    expect(html).toContain('class="summary-panel"');
    expect(html).toContain('class="primary-workspace"');
    expect(html).toContain('class="diagnostics"');
    expect(html).toContain('class="run-detail is-sticky"');
    expect(html).toContain('class="attention-card attention-card-critical"');
    expect(html).toContain(":focus-visible");
    expect(html).toContain("prefers-reduced-motion");
  });
});
