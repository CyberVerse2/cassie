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
      "classify_evidence",
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
      model: expect.objectContaining({ modelId: "google/gemini-3.1-flash-lite" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 1,
      steps: [stepWithTool("create_query_jobs")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["run_web_query", "run_x_query"],
      toolChoice: "required",
      model: expect.objectContaining({ modelId: "google/gemini-3.1-flash-lite" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 2,
      steps: [stepWithTool("create_query_jobs"), stepWithTool("run_web_query")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["classify_evidence"],
      toolChoice: { type: "tool", toolName: "classify_evidence" },
      model: expect.objectContaining({ modelId: "deepseek/deepseek-v4-flash" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 3,
      steps: [stepWithTool("classify_evidence")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["resolve_goal"],
      toolChoice: { type: "tool", toolName: "resolve_goal" },
      model: expect.objectContaining({ modelId: "gpt-5.5" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 4,
      steps: [stepWithTool("resolve_goal")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["decide_continuation"],
      toolChoice: { type: "tool", toolName: "decide_continuation" },
      model: expect.objectContaining({ modelId: "gpt-5.5" }),
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
      model: expect.objectContaining({ modelId: "gpt-5.5" }),
    });

    await expect(prepareResearchToolLoopStep({
      stepNumber: 6,
      steps: [stepWithTool("propose_adaptive_queries")],
      messages: [],
    })).resolves.toMatchObject({
      activeTools: ["run_web_query", "run_x_query"],
      toolChoice: "required",
      model: expect.objectContaining({ modelId: "google/gemini-3.1-flash-lite" }),
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
      model: expect.objectContaining({ modelId: "gpt-5.5" }),
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
            output: { type: "json", value: { raw: "x".repeat(2000), evidenceClaims: [{ id: "claim_1" }] } },
          },
        ],
      },
    ] as never);

    expect(JSON.stringify(messages)).toContain("compressed");
    expect(JSON.stringify(messages).length).toBeLessThan(900);
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
