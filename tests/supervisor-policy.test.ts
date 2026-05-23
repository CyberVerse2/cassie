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
    "classify_intent",
    "interpret_signal",
    "extract_thesis",
    "extract_inverse_thesis",
    "research_thesis",
    "critique_thesis",
    "plan_trade_expression",
    "find_polymarket_markets",
    "assess_polymarket_market",
    "quote_polymarket_market",
    "select_market",
    "risk_check",
    "create_trade_ticket",
    "finalize_run",
  ];

  it("exposes the full supervisor tool surface until finalization", () => {
    expect(selectActiveTools([])).toEqual([
      ...fullToolSurface,
    ]);

    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
    ])).toEqual(fullToolSurface);
  });

  it("exposes no tools after finalization", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("finalize_run", {}),
    ])).toEqual([]);
  });

  it("still aborts the loop on hard tool errors", () => {
    expect(() => prepareCassieSupervisorStep({
      steps: [
        errorStep("classify_intent", new Error("rate limited")),
      ],
    } as never)).toThrow("Supervisor tool classify_intent failed: rate limited");
  });

  it("lets the model recover from prerequisite data errors", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        errorStep("create_trade_ticket", new SupervisorPrerequisiteError("Trade ticket creation requires a non-rejected risk decision.")),
      ],
      messages: [],
    } as never) as { activeTools: string[]; toolChoice: unknown };

    expect(prepared.activeTools).toEqual(fullToolSurface);
    expect(prepared.toolChoice).toBe("required");
  });

  it("keeps critique substance when compressing tool messages before finalization", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("classify_intent", { intent: "critic" }),
        step("interpret_signal", {}),
        step("extract_thesis", {}),
        step("research_thesis", {}),
        step("critique_thesis", {}),
      ],
      messages: [{
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "critique_thesis_call",
          toolName: "critique_thesis",
          output: {
            finalCritique: "The valuation claim is conditional because pricing is not official.",
            strongestObjection: "The filing has no final IPO price range.",
            secondaryObjections: Array.from({ length: 80 }, (_, index) => `objection ${index}`),
          },
        }],
      }],
    } as never) as { messages: unknown[] };

    expect(JSON.stringify(prepared.messages)).toContain("The valuation claim is conditional");
    expect(JSON.stringify(prepared.messages)).toContain("The filing has no final IPO price range");
  });

  it("preserves every tool result part when compressing large tool messages", () => {
    const content = Array.from({ length: 12 }, (_, index) => ({
      type: "tool-result",
      toolCallId: `call_${index}`,
      toolName: "interpret_signal",
      output: {
        signalType: "generic_opinion",
        summary: "x".repeat(200),
      },
    }));
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("classify_intent", { intent: "trade" }),
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
