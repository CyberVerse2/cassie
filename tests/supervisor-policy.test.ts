import { describe, expect, it } from "vitest";
import { prepareCassieSupervisorStep, selectActiveTools } from "../packages/agent/policy.ts";
import { SupervisorPrerequisiteError } from "../packages/agent/tools.ts";

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
  it("exposes compact flexible tool sets before terminal states", () => {
    const opportunity = step("frame_opportunity", { userIntent: "trade" });
    const expression = step("generate_trade_expressions", {
      decision: "needs_market_check",
      highestPurityExpression: "Long SOL perps.",
    });
    const candidates = step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]);
    const selection = step("rank_expressions", {
      selectedMarket: { venue: "hyperliquid", symbol: "SOL" },
      noTradeReason: null,
    });
    const risk = step("risk_check", { decision: "approve", adjustedSizeUsd: 50 });

    expect(selectActiveTools([])).toEqual(["frame_opportunity"]);
    expect(selectActiveTools([opportunity])).toEqual(["generate_trade_expressions"]);
    expect(selectActiveTools([opportunity, expression])).toEqual([
      "generate_trade_expressions",
      "search_venues",
    ]);
    expect(selectActiveTools([opportunity, expression, candidates])).toEqual([
      "search_venues",
      "assess_expression_fit",
      "quote_expression",
      "rank_expressions",
    ]);
    expect(selectActiveTools([opportunity, expression, candidates, selection])).toEqual([
      "quote_expression",
      "rank_expressions",
      "risk_check",
    ]);
    expect(selectActiveTools([opportunity, expression, candidates, selection, risk])).toEqual(["create_trade_ticket"]);
  });

  it("keeps recovery tools available when searches or ranking do not find a trade", () => {
    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "no_trade" }),
    ])).toEqual([
      "generate_trade_expressions",
      "finalize_run",
    ]);

    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "needs_market_check" }),
      step("search_venues", []),
    ])).toEqual([
      "generate_trade_expressions",
      "search_venues",
      "finalize_run",
    ]);

    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "route_to_market_router" }),
      step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]),
      step("rank_expressions", { decision: "no_selection", selectedMarket: null, noTradeReason: null }),
    ])).toEqual([
      "search_venues",
      "rank_expressions",
      "finalize_run",
    ]);

    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "route_to_market_router" }),
      step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]),
      step("rank_expressions", { selectedMarket: null, noTradeReason: "No clean market." }),
    ])).toEqual([
      "search_venues",
      "rank_expressions",
      "finalize_run",
    ]);
  });

  it("exposes finalization around risk and ticket terminal states", () => {
    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "route_to_market_router" }),
      step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]),
      step("rank_expressions", { selectedMarket: { venue: "hyperliquid", symbol: "SOL" }, noTradeReason: null }),
      step("risk_check", { decision: "reject", reason: "Too large." }),
    ])).toEqual([
      "risk_check",
      "finalize_run",
    ]);

    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "route_to_market_router" }),
      step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]),
      step("rank_expressions", { selectedMarket: { venue: "hyperliquid", symbol: "SOL" }, noTradeReason: null }),
      step("risk_check", { decision: "approve", adjustedSizeUsd: 50 }),
      step("create_trade_ticket", { ticketId: "ticket_1" }),
    ])).toEqual(["finalize_run"]);
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

    expect(prepared.activeTools).toEqual(["frame_opportunity"]);
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
