import { describe, expect, it } from "vitest";
import { buildAdminData } from "../packages/app/admin-metrics.ts";
import type { CassieStoreSnapshot } from "../packages/core/db/store.ts";

const emptySnapshot = (): CassieStoreSnapshot => ({
  mentions: [],
  tradeTickets: [],
  executionJobs: [],
  positions: [],
  positionReviews: [],
  withdrawals: [],
  walletSpendLedgerEntries: [],
  auditEvents: [],
  userSettings: [],
  controlRuns: [],
  runSteps: [],
  modelCallUsage: [],
});

describe("admin metrics", () => {
  it("surfaces consumed model tokens in overview totals", () => {
    const snapshot = emptySnapshot();
    snapshot.modelCallUsage.push(
      {
        id: "usage_1",
        controlRunId: "run_1",
        runStepId: "step_1",
        purpose: "opportunity",
        provider: "google",
        model: "gemini-3-pro",
        promptName: "cassie_opportunity_frame",
        promptVersion: "2026-05-20",
        inputTokens: 100,
        outputTokens: 40,
        reasoningTokens: 10,
        cachedTokens: 5,
        totalTokens: 150,
        estimatedCostUsd: 0.01,
        latencyMs: 800,
        thinkingTrace: null,
        status: "succeeded",
        error: null,
        createdAt: "2026-05-20T12:00:00.000Z",
      },
      {
        id: "usage_2",
        controlRunId: "run_2",
        runStepId: null,
        purpose: "finalization",
        provider: "google",
        model: "gemini-3-pro",
        promptName: null,
        promptVersion: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cachedTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
        latencyMs: null,
        thinkingTrace: null,
        status: "failed",
        error: "model call failed",
        createdAt: "2026-05-20T12:01:00.000Z",
      },
    );

    const data = buildAdminData({
      snapshot,
      webhookReceipts: [],
      now: "2026-05-20T12:02:00.000Z",
    });

    expect(data.overview.totals.tokensConsumed).toBe(150);
    expect(data.ops.modelCosts.totalTokens).toBe(150);
  });
});
