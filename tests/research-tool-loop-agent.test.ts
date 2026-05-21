import { describe, expect, it } from "vitest";
import {
  compressResearchToolMessages,
  createResearchToolLoopAgent,
  extractDoneAnswer,
  prepareResearchToolLoopStep,
} from "../packages/ai/agents/research-tool-loop-agent.ts";

describe("research ToolLoopAgent configuration", () => {
  it("creates a forced-tool agent with the expected research tools", () => {
    const agent = createResearchToolLoopAgent();

    expect(Object.keys(agent.tools)).toEqual([
      "create_query_jobs",
      "run_web_query",
      "run_x_query",
      "resolve_goal",
      "decide_continuation",
      "propose_adaptive_queries",
      "done",
    ]);
  });

  it("phase-gates tools and routes models through prepareStep", async () => {
    await expect(prepareResearchToolLoopStep({ stepNumber: 0, steps: [], messages: [] })).resolves.toMatchObject({
      activeTools: ["create_query_jobs"],
      toolChoice: { type: "tool", toolName: "create_query_jobs" },
      model: expect.objectContaining({ modelId: "gemini-3.1-flash-lite" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 1,
      steps: [stepWithTool("create_query_jobs")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["run_web_query", "run_x_query"],
      toolChoice: "required",
      model: expect.objectContaining({ modelId: "gemini-3.1-flash-lite" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 2,
      steps: [stepWithTool("create_query_jobs"), stepWithTool("run_web_query")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["resolve_goal"],
      toolChoice: { type: "tool", toolName: "resolve_goal" },
      model: expect.objectContaining({ modelId: "gemini-3.5-flash" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 4,
      steps: [stepWithTool("resolve_goal")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["decide_continuation"],
      toolChoice: { type: "tool", toolName: "decide_continuation" },
      model: expect.objectContaining({ modelId: "gemini-3.5-flash" }),
    });
  });

  it("switches to adaptive query tools when continuation requests adaptation", async () => {
    await expect(prepareResearchToolLoopStep({
      stepNumber: 5,
      steps: [stepWithTool("decide_continuation", { action: "continue_with_adaptive_queries" })],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["propose_adaptive_queries"],
      toolChoice: { type: "tool", toolName: "propose_adaptive_queries" },
      model: expect.objectContaining({ modelId: "gemini-3.5-flash" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 6,
      steps: [stepWithTool("propose_adaptive_queries")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["run_web_query", "run_x_query"],
      toolChoice: "required",
      model: expect.objectContaining({ modelId: "gemini-3.1-flash-lite" }),
    });
  });

  it("forces explicit done after continuation says to stop or finish", async () => {
    await expect(prepareResearchToolLoopStep({
      stepNumber: 5,
      steps: [stepWithTool("decide_continuation", { action: "stop_no_trade" })],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["done"],
      toolChoice: { type: "tool", toolName: "done" },
      model: expect.objectContaining({ modelId: "gemini-3.5-flash" }),
    });
  });

  it("compresses oversized tool messages before later reasoning steps", () => {
    const messages = compressResearchToolMessages([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "1",
            toolName: "run_web_query",
            output: {
              type: "json",
              value: {
                raw: "x".repeat(2000),
                searchResults: [{
                  id: "result_1",
                  queryJobId: "job_1",
                  queryId: "q_1",
                  goalIds: ["g_verify"],
                  provider: "gemini_google_search",
                  title: "SEC filing",
                  url: "https://sec.gov/example",
                  sourceType: "filing",
                  snippet: "Primary filing confirms the event.",
                }],
                evidenceClaims: [{
                  id: "claim_1",
                  resultId: "result_1",
                  queryJobId: "job_1",
                  queryId: "q_1",
                  goalIds: ["g_verify"],
                  claimText: "The filing exists.",
                  sourceType: "filing",
                  directness: "primary",
                  reliability: "high",
                  extractionConfidence: 0.93,
                }],
                goalEvidenceLinks: [{
                  id: "link_1",
                  evidenceClaimId: "claim_1",
                  goalId: "g_verify",
                  stance: "contradicts",
                  strength: 0.8,
                  relevance: 0.9,
                  rationale: "The claim contradicts the assumed nonexistence of the filing.",
                }],
                goalResolutions: [{
                  goalId: "g_tradeability",
                  status: "unresolved",
                  confidence: 0.4,
                  summary: "No tradable instrument confirmed.",
                  missingEvidence: ["official ticker"],
                  synthesisImplication: "Do not route to trade.",
                }],
              },
            },
          },
        ],
      },
    ] as never);

    const serialized = JSON.stringify(messages);
    expect(serialized).toContain("research_tool_digest");
    expect(serialized).toContain("The filing exists.");
    expect(serialized).toContain("contradicts");
    expect(serialized).toContain("official ticker");
    expect(serialized).toContain("filing source may need exact wording");
    expect(serialized).not.toContain("x".repeat(100));
    expect(serialized.length).toBeLessThan(3000);
  });

  it("extracts the final answer from an explicit done tool call", () => {
    expect(extractDoneAnswer({
      staticToolCalls: [{ toolName: "done", input: { answer: "finished" } }],
    })).toBe("finished");
  });
});

function stepWithTool(toolName: string, output: unknown = {}) {
  return {
    toolCalls: [{ toolName }],
    toolResults: [{ toolName, output }],
  } as never;
}
