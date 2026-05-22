import { describe, expect, it } from "vitest";
import { prepareCassieSupervisorStep, selectActiveTools } from "../packages/ai/agents/supervisor/policy.ts";

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

    expect(selectActiveTools([
      step("classify_intent", { intent: "critic" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("critique_thesis", {}),
    ])).toEqual(["plan_trade_expression"]);

    expect(selectActiveTools([
      step("classify_intent", { intent: "critic" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("critique_thesis", {}),
      step("plan_trade_expression", {
        decision: "needs_market_check",
        tradeExpressionConfidence: 0.32,
        insufficiency: {
          score: 0.32,
          requiredThreshold: 0.65,
          failedDimensions: ["market_discovery"],
          summary: "No venue-confirmed market.",
          evidenceNeededToClear: ["Venue market confirmation"],
        },
        candidates: [],
      }),
    ])).toEqual(["select_market"]);

    expect(selectActiveTools([
      step("classify_intent", { intent: "critic" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("critique_thesis", {}),
      step("plan_trade_expression", {
        decision: "needs_market_check",
        candidates: [{ tradableNow: false }],
      }),
    ])).toEqual(["select_market"]);

    expect(selectActiveTools([
      step("classify_intent", { intent: "critic" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("critique_thesis", {}),
      step("plan_trade_expression", {
        decision: "route_to_market_router",
        candidates: [{ tradableNow: true }],
      }),
    ])).toEqual(["select_market"]);
  });

  it("allows watchlist only for explicit watch requests", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "watch" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
    ])).toEqual(["research_thesis"]);

    expect(selectActiveTools([
      step("classify_intent", { intent: "watch" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", {
        decision: "needs_market_check",
        tradeExpressionConfidence: 0.32,
        candidates: [],
      }),
    ])).toEqual(["select_market"]);
  });

  it("blocks ticket creation after rejected risk", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", {
        decision: "route_to_market_router",
        candidates: [{ tradableNow: true }],
      }),
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

  it("does not advance past failed required tools", () => {
    expect(selectActiveTools([
      step("classify_intent"),
    ])).toEqual(["classify_intent"]);

    expect(() => prepareCassieSupervisorStep({
      steps: [
        errorStep("classify_intent", new Error("rate limited")),
      ],
    } as never)).toThrow("Supervisor tool classify_intent failed: rate limited");
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
