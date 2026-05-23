import { describe, expect, it } from "vitest";
import type { CassieStoreSnapshot } from "../packages/core/db/store.ts";
import { formatRunTimeline } from "../src/timeline.ts";

const snapshot: CassieStoreSnapshot = {
  mentions: [],
  tradeTickets: [],
  executionJobs: [],
  auditEvents: [],
  userSettings: [],
  controlRuns: [
    {
      runId: "run_1",
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: "https://x.com/example/status/post_1",
        authorHandle: "example",
        authorName: "Example",
        text: "Exa raised $250M.",
        createdAt: "2026-05-21T00:00:00.000Z",
      },
      status: "succeeded",
      result: { responseType: "analysis" },
      error: null,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:10.000Z",
    },
  ],
  runSteps: [
    {
      stepId: "step_opportunity",
      runId: "run_1",
      stepType: "opportunity",
      status: "succeeded",
      input: { userCommand: "@Cassie critic this" },
      output: {
        userIntent: "critic",
        literalClaim: "Exa raised $250M.",
        opportunity: "Private AI funding could affect adjacent public/private AI exposure.",
      },
      error: null,
      model: "deepseek-v4-pro",
      promptName: "cassie_opportunity_frame",
      promptVersion: "2026-05-20",
      startedAt: "2026-05-21T00:00:01.000Z",
      completedAt: "2026-05-21T00:00:02.000Z",
    },
  ],
  modelCallUsage: [
    {
      id: "usage_1",
      controlRunId: "run_1",
      runStepId: null,
      purpose: "supervisor_step",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      promptName: "cassie_supervisor",
      promptVersion: "2026-05-20",
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 20,
      cachedTokens: 0,
      totalTokens: 150,
      estimatedCostUsd: null,
      latencyMs: null,
      status: "succeeded",
      error: null,
      createdAt: "2026-05-21T00:00:08.000Z",
    },
  ],
};

describe("run timeline", () => {
  it("formats a timeline with tools, visible reasoning, and token usage", () => {
    const timeline = formatRunTimeline(snapshot, "run_1");

    expect(timeline).toContain("CASSIE RUN TIMELINE");
    expect(timeline).toContain("[ok] run_1 ok");
    expect(timeline).toContain("|-- [ai] opportunity [ok] 1.0s");
    expect(timeline).toContain("|   |-- model deepseek-v4-pro");
    expect(timeline).toContain("|   |-- thinking Frame the raw verifiable signal into a market opportunity");
    expect(timeline).toContain("model");
    expect(timeline).toContain("deepseek-v4-pro");
    expect(timeline).toContain("|-- [tokens] total=150 input=100 output=50 reasoning=20 cache=0");
  });
});
