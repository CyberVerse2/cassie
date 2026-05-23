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
});
