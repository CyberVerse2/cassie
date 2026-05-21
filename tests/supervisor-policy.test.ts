import { describe, expect, it } from "vitest";
import { selectActiveTools } from "../packages/ai/agents/supervisor/policy.ts";

function step(toolName: string, output?: unknown) {
  return {
    toolCalls: [{ type: "tool-call" as const, toolCallId: `${toolName}_call`, toolName, input: {} }],
    toolResults: output === undefined
      ? []
      : [{ type: "tool-result" as const, toolCallId: `${toolName}_call`, toolName, input: {}, output }],
  };
}

describe("supervisor step policy", () => {
  it("starts with intent routing, signal interpretation, and thesis extraction", () => {
    expect(selectActiveTools([])).toEqual(["classify_intent"]);
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
    ])).toEqual(["interpret_signal"]);
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
    ])).toEqual(["extract_thesis"]);
  });

  it("routes critic requests through research and critique", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "critic" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
    ])).toEqual(["research_thesis"]);

    expect(selectActiveTools([
      step("classify_intent", { intent: "critic" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
    ])).toEqual(["critique_thesis"]);
  });

  it("blocks ticket creation after rejected risk", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("select_market", {}),
      step("risk_check", { decision: "reject", reason: "No." }),
    ])).toEqual(["finalize_run"]);
  });

  it("exposes no tools after finalization", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("finalize_run", {}),
    ])).toEqual([]);
  });
});
