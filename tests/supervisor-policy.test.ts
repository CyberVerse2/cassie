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

const tradeExpression = {
  decision: "route_to_market_router",
  candidates: [{ tradableNow: true, venue: "polymarket" }],
  highestPurityExpression: "Long SOL perp.",
  marketRouterInstructions: "Prefer direct SOL perps.",
};

const noTradeExpression = {
  decision: "no_trade",
  candidates: [],
  highestPurityExpression: "No clean expression.",
  marketRouterInstructions: null,
};

describe("supervisor step policy", () => {
  it("starts with broad analytical tools instead of a single fixed first tool", () => {
    expect(selectActiveTools([])).toEqual([
      "classify_intent",
      "interpret_signal",
      "extract_thesis",
    ]);
  });

  it("requires core trade context before finalization is available", () => {
    const afterThesis = selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
    ]);

    expect(afterThesis).toEqual(expect.arrayContaining([
      "research_thesis",
      "plan_trade_expression",
    ]));
    expect(afterThesis).not.toContain("finalize_run");

    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", noTradeExpression),
    ])).toContain("finalize_run");
  });

  it("does not allow early finalization after intent and signal only", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
    ])).not.toContain("finalize_run");
  });

  it("allows critique after research context exists", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "critic" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
    ])).toEqual(expect.arrayContaining([
      "critique_thesis",
      "plan_trade_expression",
    ]));
  });

  it("unlocks market tools after a tradable expression exists", () => {
    expect(selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", tradeExpression),
    ])).toEqual(expect.arrayContaining([
      "find_polymarket_markets",
      "select_market",
      "finalize_run",
    ]));
  });

  it("does not unlock risk or ticket tools until market selection and risk prerequisites exist", () => {
    expect(selectActiveTools([
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", tradeExpression),
    ])).not.toEqual(expect.arrayContaining(["risk_check", "create_trade_ticket"]));

    expect(selectActiveTools([
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", tradeExpression),
      step("select_market", { selectedMarket: { symbol: "SOL" }, noTradeReason: null }),
    ])).toEqual(expect.arrayContaining(["risk_check"]));

    expect(selectActiveTools([
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", tradeExpression),
      step("select_market", { selectedMarket: { symbol: "SOL" }, noTradeReason: null }),
      step("risk_check", { decision: "approve" }),
    ])).toEqual(expect.arrayContaining(["create_trade_ticket"]));
  });

  it("keeps finalization available for no-trade analysis without risk or ticket tools", () => {
    const activeTools = selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", noTradeExpression),
    ]);

    expect(activeTools).toContain("finalize_run");
    expect(activeTools).not.toContain("risk_check");
    expect(activeTools).not.toContain("create_trade_ticket");
  });

  it("blocks ticket creation after rejected risk", () => {
    const activeTools = selectActiveTools([
      step("classify_intent", { intent: "trade" }),
      step("interpret_signal", {}),
      step("extract_thesis", {}),
      step("research_thesis", {}),
      step("plan_trade_expression", tradeExpression),
      step("select_market", { selectedMarket: { symbol: "SOL" }, noTradeReason: null }),
      step("risk_check", { decision: "reject", reason: "No." }),
    ]);

    expect(activeTools).toContain("finalize_run");
    expect(activeTools).not.toContain("create_trade_ticket");
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
    ])).toEqual(["classify_intent", "interpret_signal", "extract_thesis"]);

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
