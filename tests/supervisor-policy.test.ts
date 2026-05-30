import { describe, expect, it } from "vitest";
import { createCassieStopConditions, prepareCassieSupervisorStep, selectActiveTools } from "../packages/agent/policy.ts";
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
  it("exposes one next tool after each known staged state", () => {
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
    const preflight = step("preflight_user_policy", { status: "ok", warnings: [] });

    expect(selectActiveTools([])).toEqual(["preflight_user_policy"]);
    expect(selectActiveTools([preflight])).toEqual(["resolve_source", "frame_opportunity"]);
    const source = step("resolve_source", { text: "OpenAI revenue growth is accelerating." });
    expect(selectActiveTools([preflight, source])).toEqual(["frame_opportunity"]);
    expect(selectActiveTools([preflight, source, opportunity])).toEqual(["generate_trade_expressions"]);
    expect(selectActiveTools([opportunity, expression])).toEqual(["search_venues"]);
    expect(selectActiveTools([opportunity, expression, candidates])).toEqual(["assess_expression_fit"]);
    const fit = step("assess_expression_fit", { fitStatus: "validated", candidateId: "hyperliquid:SOL:long" });
    expect(selectActiveTools([opportunity, expression, candidates, fit])).toEqual(["quote_expression"]);
    const quote = step("quote_expression", { venue: "hyperliquid", symbol: "SOL", markPrice: 100 });
    expect(selectActiveTools([opportunity, expression, candidates, fit, quote])).toEqual(["rank_expressions"]);
    expect(selectActiveTools([opportunity, expression, candidates, selection])).toEqual(["create_trade_ticket"]);
  });

  it("finalizes when searches or ranking do not find a trade", () => {
    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "no_trade" }),
    ])).toEqual(["finalize_run"]);

    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "needs_market_check" }),
      step("search_venues", []),
    ])).toEqual(["finalize_run"]);

    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "route_to_market_router" }),
      step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]),
      step("rank_expressions", { decision: "no_selection", selectedMarket: null, noTradeReason: null }),
    ])).toEqual(["finalize_run"]);

    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "route_to_market_router" }),
      step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]),
      step("rank_expressions", { selectedMarket: null, noTradeReason: "No clean market." }),
    ])).toEqual(["finalize_run"]);
  });

  it("searches venues when a no-trade expression still contains searchable candidates", () => {
    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", {
        decision: "no_trade",
        candidateExpressions: [{
          expressionRail: "pre_ipo",
          intendedSide: "long",
          searchTerms: ["turbopuffer pre-IPO"],
          requiredMarketFeatures: ["Configured private-company listing"],
        }],
      }),
    ])).toEqual(["search_venues"]);
  });

  it("exposes finalization after ticket creation", () => {
    expect(selectActiveTools([
      step("frame_opportunity", {}),
      step("generate_trade_expressions", { decision: "route_to_market_router" }),
      step("search_venues", [{ venue: "hyperliquid", symbol: "SOL" }]),
      step("rank_expressions", { selectedMarket: { venue: "hyperliquid", symbol: "SOL" }, noTradeReason: null }),
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
        errorStep("create_trade_ticket", new SupervisorPrerequisiteError("Trade ticket creation requires a usable market selection.")),
      ],
      messages: [],
    } as never) as { activeTools: string[]; toolChoice: unknown };

    expect(prepared.activeTools).toEqual(["preflight_user_policy"]);
    expect(prepared.toolChoice).toEqual({ type: "tool", toolName: "preflight_user_policy" });
  });

  it("requires tool calls while staged work remains active", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("frame_opportunity", {}),
        step("generate_trade_expressions", { decision: "needs_market_check" }),
      ],
      messages: [],
    } as never) as { activeTools: string[]; toolChoice: unknown };

    expect(prepared.activeTools).toEqual([
      "search_venues",
    ]);
    expect(prepared.toolChoice).toEqual({ type: "tool", toolName: "search_venues" });
  });

  it("quotes a direct validated candidate before assessing weak adjacent candidates", () => {
    const opportunity = step("frame_opportunity", {});
    const expression = step("generate_trade_expressions", { decision: "needs_market_check" });
    const candidates = step("search_venues", [
      { venue: "hyperliquid", symbol: "BTC", side: "short" },
      { venue: "polymarket", symbol: "btc-price-market", side: "buy_no", conditionId: "condition_1", outcomeTokenId: "token_no" },
    ]);
    const firstFit = step("assess_expression_fit", {
      candidateId: "hyperliquid:BTC:short",
      fitStatus: "validated",
      venue: "hyperliquid",
      directness: "direct",
    });

    expect(selectActiveTools([opportunity, expression, candidates, firstFit])).toEqual(["quote_expression"]);
  });

  it("keeps assessing venue candidates when no direct candidate has validated", () => {
    const opportunity = step("frame_opportunity", {});
    const expression = step("generate_trade_expressions", { decision: "needs_market_check" });
    const candidates = step("search_venues", [
      { venue: "hyperliquid", symbol: "BTC", side: "short" },
      { venue: "polymarket", symbol: "btc-price-market", side: "buy_no", conditionId: "condition_1", outcomeTokenId: "token_no" },
    ]);
    const firstFit = step("assess_expression_fit", {
      candidateId: "hyperliquid:BTC:short",
      fitStatus: "needs_more_info",
      venue: "hyperliquid",
      directness: "strong_proxy",
    });

    expect(selectActiveTools([opportunity, expression, candidates, firstFit])).toEqual(["assess_expression_fit"]);
  });

  it("injects venue discovery progress for the next candidate", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("frame_opportunity", {}),
        step("generate_trade_expressions", { decision: "needs_market_check" }),
        step("search_venues", [
          { venue: "hyperliquid", symbol: "BTC", side: "short" },
          { venue: "polymarket", symbol: "btc-price-market", side: "buy_no", conditionId: "condition_1", outcomeTokenId: "token_no" },
        ]),
        step("assess_expression_fit", {
          candidateId: "hyperliquid:BTC:short",
          fitStatus: "validated",
          venue: "hyperliquid",
          directness: "direct",
        }),
      ],
      messages: [],
    } as never) as { activeTools: string[]; messages: unknown[] };

    const serialized = JSON.stringify(prepared.messages);
    expect(prepared.activeTools).toEqual(["quote_expression"]);
    expect(serialized).toContain("venueDiscoveryProgress");
    expect(serialized).toContain("nextUnquotedCandidate");
    expect(serialized).toContain("BTC");
  });

  it("quotes every validated venue candidate before ranking", () => {
    const opportunity = step("frame_opportunity", {});
    const expression = step("generate_trade_expressions", { decision: "needs_market_check" });
    const candidates = step("search_venues", [
      { venue: "hyperliquid", symbol: "BTC", side: "short" },
      { venue: "polymarket", symbol: "btc-price-market", side: "buy_no", conditionId: "condition_1", outcomeTokenId: "token_no" },
    ]);
    const firstFit = step("assess_expression_fit", {
      candidateId: "hyperliquid:BTC:short",
      fitStatus: "validated",
      venue: "hyperliquid",
    });
    const secondFit = step("assess_expression_fit", {
      candidateId: "polymarket:condition_1:token_no:buy_no",
      fitStatus: "validated",
      venue: "polymarket",
    });
    const firstQuote = step("quote_expression", { venue: "hyperliquid", symbol: "BTC", side: "short" });

    expect(selectActiveTools([opportunity, expression, candidates, firstFit, secondFit, firstQuote])).toEqual(["quote_expression"]);
  });

  it("forces the exact next tool and injects authoritative persisted state", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("frame_opportunity", {
          userIntent: "trade",
          opportunity: "SOL ETF approval could reprice SOL.",
        }),
        step("generate_trade_expressions", {
          decision: "needs_market_check",
          directAsset: "SOL",
          highestPurityExpression: "Long SOL perp.",
        }),
        step("search_venues", [{
          venue: "hyperliquid",
          symbol: "SOL",
          side: "long",
          markPrice: 100,
          liquidityScore: 1,
          reason: "SOL perp was found in live Hyperliquid metadata.",
        }]),
        step("assess_expression_fit", {
          candidateId: "hyperliquid:SOL:long",
          expressionId: "expr-sol-long",
          fitStatus: "validated",
          venue: "hyperliquid",
          fitScore: 0.96,
        }),
      ],
      messages: [],
    } as never) as { activeTools: string[]; toolChoice: unknown; messages: unknown[] };

    expect(prepared.activeTools).toEqual(["quote_expression"]);
    expect(prepared.toolChoice).toEqual({ type: "tool", toolName: "quote_expression" });
    expect(JSON.stringify(prepared.messages)).toContain("Authoritative persisted supervisor state");
    expect(JSON.stringify(prepared.messages)).toContain("SOL perp was found in live Hyperliquid metadata");
    expect(JSON.stringify(prepared.messages)).toContain("hyperliquid:SOL:long");
    expect(JSON.stringify(prepared.messages)).toContain("fitStatus");
    expect(JSON.stringify(prepared.messages)).toContain("validated");
  });

  it("uses finalize and step-count stop conditions", () => {
    expect(createCassieStopConditions()).toHaveLength(2);
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

  it("keeps venue candidate arrays when compressing large tool messages", () => {
    const prepared = prepareCassieSupervisorStep({
      steps: [
        step("frame_opportunity", {}),
        step("generate_trade_expressions", { decision: "needs_market_check" }),
        step("search_venues", [{
          venue: "hyperliquid",
          symbol: "ETH",
          side: "long",
          markPrice: 2121.3,
          reason: "ETH perp was found in live Hyperliquid metadata.",
        }]),
      ],
      messages: [{
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "search_venues_call",
          toolName: "search_venues",
          output: Array.from({ length: 40 }, (_, index) => ({
            venue: "hyperliquid",
            symbol: index === 0 ? "ETH" : `TEST${index}`,
            side: "long",
            reason: index === 0 ? "ETH perp was found in live Hyperliquid metadata." : "Extra candidate.",
          })),
        }],
      }],
    } as never) as { messages: unknown[] };

    const serialized = JSON.stringify(prepared.messages);
    expect(serialized).toContain("ETH perp was found in live Hyperliquid metadata");
    expect(serialized).toContain("\"count\":40");
    expect(serialized).toContain("\"omittedItems\":32");
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
