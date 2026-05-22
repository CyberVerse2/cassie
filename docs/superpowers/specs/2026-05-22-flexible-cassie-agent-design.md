# Flexible Cassie Agent Workflow Design

## Goal

Make Cassie's supervisor flexible throughout the workflow, closer to Warden's agentic tool loop, while preserving production safety for market selection, risk checks, trade tickets, and execution boundaries.

Cassie should always produce the best grounded result from available context. It should not ask the user follow-up questions mid-run. When intent, size, market, or risk preference is ambiguous, Cassie resolves conservatively and states the decision in the final output.

## Current Shape

The current supervisor is a fixed ordered pipeline. Code selects the next tool from prior step completion:

- classify intent
- interpret signal
- extract thesis
- optionally extract inverse thesis
- research thesis
- critique or plan trade expression
- find and select markets
- run risk check
- create trade ticket
- finalize

This gives strong auditability, but it makes Cassie rigid. The model cannot naturally skip ahead, revisit research, compare multiple trade expressions, inspect markets earlier, stop with a useful analysis, or use a different valid path when the prompt does not fit the pipeline.

## Proposed Shape

Replace the fixed supervisor policy with a dynamic governed tool loop.

The supervisor model can choose tools throughout the run. Code no longer forces one global order. Instead, code exposes a state-aware set of valid tools and validates every tool call and final result against persisted canonical state.

The agent remains domain-specific. It does not receive arbitrary external tools like Warden. It receives Cassie tools for intent, signal interpretation, thesis work, research, critique, trade-expression planning, market discovery, market selection, risk checks, trade-ticket creation, and finalization.

## Control Model

Use a flexible loop with guarded doors:

- Early and analytical tools are broadly available.
- Market tools unlock when there is enough thesis or trade-expression context.
- Risk checks unlock only after a real market selection exists.
- Trade-ticket creation unlocks only after a non-rejected risk decision exists.
- Finalization is allowed whenever a coherent grounded result can be produced.

The model can decide whether to continue researching, revise the thesis, inspect markets, critique the idea, route toward a ticket, or finalize with no-trade analysis. The validators decide whether a requested action is allowed.

## Required Guarantees

Cassie must never:

- execute an order from the supervisor
- invent markets, prices, account state, risk decisions, or approvals
- create a trade ticket without a real selected market
- create a trade ticket without a non-rejected risk check
- present rejected risk as approved
- ask the user follow-up questions mid-run
- silently degrade AI routing, ranking, matching, classification, or selection into keyword heuristics

Cassie must always:

- persist tool outputs as run steps
- canonicalize final inputs from persisted outputs
- ground final summaries in tool outputs
- produce an answer, critique, no-trade result, watch result, or trade ticket from available context
- treat ambiguity conservatively

## Tool Policy

The new `prepareStep` should derive active tools from run state instead of a fixed sequence.

Base tools:

- `classify_intent`
- `interpret_signal`
- `extract_thesis`
- `extract_inverse_thesis`
- `research_thesis`
- `critique_thesis`
- `plan_trade_expression`
- `finalize_run`

Market tools:

- `find_polymarket_markets`
- `select_market`

Risk and ticket tools:

- `risk_check`
- `create_trade_ticket`

`finalize_run` remains available after enough context exists for a grounded output. The finalization validator rejects inconsistent final results, such as a trade-ticket response without a ticket or a market selection that was not persisted.

## Finalization Modes

Support these final result modes:

- `analysis`: grounded answer or no-trade result
- `critique`: researched critique of the premise or trade idea
- `watch`: watchlist-style result when the user asks to monitor or wait
- `trade_ticket`: proposed ticket awaiting approval or auto-approval handling

If the run is ambiguous, Cassie picks the safest valid mode. For example, unclear size should not block analysis, but it should prevent an oversized or fabricated ticket.

## Error Handling

Tool errors should still fail the run unless they are explicitly represented as a successful no-data result by the tool itself. The supervisor should not paper over missing dependencies. If an AI, market-data, research, account-state, or Polymarket dependency is required and unavailable, the run should fail clearly or finalize with a dependency-limited result only when a tool returned that limitation as structured output.

## Testing

Add focused tests for:

- dynamic tool exposure from different persisted states
- early finalization into analysis when market routing is unnecessary
- revisiting or branching into research before market selection
- trade-ticket prerequisites
- rejected risk finalizes without ticket creation
- ambiguous command produces conservative output without asking follow-up questions
- tool-call validation rejects invented markets, unresolved placeholders, and missing canonical state

## Migration Plan

Keep the current tool implementations and persisted step model. Change the supervisor policy first, then adjust finalization schemas only where needed.

This minimizes blast radius: Cassie's semantic tools, run-step persistence, audit logging, model usage tracking, risk evaluation, ticket creation, and execution queue boundaries remain intact.
