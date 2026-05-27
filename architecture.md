# Cassie Architecture

Cassie is an X-native trade-expression and ticketing agent. A mention or CLI test creates a durable run. A Graphile Worker supervisor job then drives bounded AI tools, records every step, and stops at structured analysis, no-trade, or a trade ticket.

Cassie can reason with AI, but trading and execution decisions pass through code-owned gates.

```text
X mention / CLI test command
-> durable run
-> Graphile supervisor job
-> AI SDK ToolLoopAgent
-> bounded tools
-> run steps
-> analysis / no-trade / trade ticket
-> execution worker
```

## Code Layout

```text
src/
  cli.ts                  CLI frontend
  worker.ts               Graphile worker entrypoint
  poller.ts               X polling entrypoint
  visibility.ts           CLI trace formatting
  helpers/                CLI/runtime helper functions

packages/
  adapters/               Hyperliquid and Polymarket venue adapters
  agent/                  Cassie supervisor loop, policy, and tool contracts
  ai/                     model-provider clients and SDK configuration
  app/                    product facade and X polling helpers
  core/                   shared schemas, ids, trace, connector errors
  execution/              venue/webhook execution clients and account state
  helpers/                shared helper utilities
  jobs/                   Graphile job enqueueing and workers
  prompts/                prompt builders used by Cassie tools
  risk/                   deterministic risk checks
  tickets/                ticket creation helpers
```

`src` contains local runtime and testing entrypoints. Package-owned implementation lives under `packages`.

## Queued Runs

The canonical mention path is queued.

```text
CassieProduct.createMentionRun
-> store.createRun
-> store.addRunStep(intake)
-> GraphileExecutionJobQueue.enqueueSupervisor
-> runCassieSupervisorForRun
```

The supervisor job loads the run, user settings, account state, and tool dependencies, then starts the AI SDK supervisor. Tool results are persisted as `run_steps`.

## Supervisor

The supervisor uses `ToolLoopAgent` with constrained tools:

```text
frame_opportunity
generate_trade_expressions
search_venues
assess_expression_fit
quote_expression
rank_expressions
risk_check
create_trade_ticket
finalize_run
```

The supervisor never receives a direct order-placement tool. It creates a trade ticket after market selection and deterministic risk sizing.

## Model Routing

Cassie separates mechanical extraction from analyst judgment.

```text
Cheap model: DeepSeek v4 Flash through the DeepSeek AI SDK
Important model: DeepSeek v4 Pro through the DeepSeek AI SDK for judgment and trade expression
X search: Grok 4.3 with image/video understanding
```

Cheap models handle extraction and tagging. DeepSeek v4 Pro handles trade-expression planning and whether a trade is justified.

## Trading

The trading path is intentionally split.

```text
untrusted post
-> opportunity frame
-> trade-expression candidates
-> real venue search
-> expression ranking
-> deterministic risk check
-> trade ticket
-> execution worker
```

Execution rechecks account state and risk before sending an order to the venue or webhook client.

## Persistence

Postgres stores:

```text
user settings
mentions
control runs
run steps
trade tickets
execution jobs
runtime state
audit events
```

Graphile Worker owns background execution for supervisor runs and trade-ticket execution jobs.
