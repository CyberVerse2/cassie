import { describe, expect, it } from "vitest";
import { prepareCassieSupervisorStep, selectActiveTools } from "../packages/agent/supervisor/policy.ts";
import { SupervisorPrerequisiteError } from "../packages/agent/supervisor/tools.ts";

function step(toolName: string, output?: unknown) {
  return {
    toolCalls: [{ type: "tool-call" as const, toolCallId: `${toolName}_call`, toolName, input: {} }],
    toolResults: output === undefined
      ? []
      : [{ type: "tool-result" as const, toolCallId: `${toolName}_call`, toolName, input: {}, output }],
  };
}

function errorStep(toolName: string, error: Error) {
  return {
    toolCalls: [{ type: "tool-call" as const, toolCallId: `${toolName}_call`, toolName, input: {} }],
    toolResults: [],
    content: [{ type: "tool-error" as const, toolCallId: `${toolName}_call`, toolName, input: {}, error }],
  };
}

describe("supervisor step policy", () => {
  const fullToolSurface = [
    "frame_opportunity",
    "generate_trade_expressions",
    "search_venues",
    "assess_expression_fit",
    "quote_expression",
    "rank_expressions",
    "risk_check",
    "create_trade_ticket",
    "finalize_run",
  ];

  it("exposes the full supervisor tool surface until finalization", () => {
    expect(selectActiveTools([])).toEqual([
      ...fullToolSurface,
    ]);

    expect(selectActiveTools([
      step("generate_trade_expressions", {}),
    ])).toEqual(fullToolSurface);
  });

  it("exposes no tools after finalization", () => {
    expect(selectActiveTools([
      step("generate_trade_expressions", {}),
      step("finalize_run", {}),
    ])).toEqual([]);
  });

  it("still aborts the loop on hard tool errors", () => {
    expect(() => prepareCassieSupervisorStep({
      steps: [
        errorStep("generate_trade_expressions", new Error("rate limited")),
      ],
    } as never)).toThrow("Supervisor tool generate_trade_expressions failed: rate limited");
  });

  it("lets the model recover from prerequisite data errors", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        errorStep("create_trade_ticket", new SupervisorPrerequisiteError("Trade ticket creation requires a non-rejected risk decision.")),
      ],
      messages: [],
    } as never) as { activeTools: string[]; toolChoice: unknown };

    expect(prepared.activeTools).toEqual(fullToolSurface);
    expect(prepared.toolChoice).toBe("auto");
  });

  it("keeps trade-expression substance when compressing tool messages before finalization", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("generate_trade_expressions", {}),
      ],
      messages: [{
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "generate_trade_expressions_call",
          toolName: "generate_trade_expressions",
          output: {
            reason: "The cleanest route is the prediction market because it directly tracks the event.",
            highestPurityExpression: "Buy YES on the listed event market.",
            candidates: Array.from({ length: 80 }, (_, index) => ({ instrument: `candidate ${index}` })),
          },
        }],
      }],
    } as never) as { messages: unknown[] };

    expect(JSON.stringify(prepared.messages)).toContain("The cleanest route is the prediction market");
    expect(JSON.stringify(prepared.messages)).toContain("Buy YES on the listed event market");
  });

  it("preserves every tool result part when compressing large tool messages", () => {
    const content = Array.from({ length: 12 }, (_, index) => ({
      type: "tool-result",
      toolCallId: `call_${index}`,
      toolName: "generate_trade_expressions",
      output: {
        decision: "needs_market_check",
        reason: "x".repeat(200),
      },
    }));
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("generate_trade_expressions", {}),
      ],
      messages: [{
        role: "tool",
        content,
      }],
    } as never) as { messages: Array<{ content: Array<{ toolCallId: string }> }> };

    expect(prepared.messages[0]?.content.map((part) => part.toolCallId)).toEqual(
      content.map((part) => part.toolCallId),
    );
  });
});
