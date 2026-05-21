# Cassie Architecture

Cassie is an X-native trading research and ticketing agent. A mention creates a durable control-plane run. A Graphile Worker supervisor job then drives bounded AI tools, records every step, and stops at a structured response, critique, watchlist decision, or trade ticket.

Cassie can reason with AI, but trading and execution decisions pass through code-owned gates.

```text
X mention / API request / CLI command
-> durable control run
-> Graphile supervisor job
-> AI SDK ToolLoopAgent
-> bounded tools
-> run steps + research ledger
-> response / critique / trade ticket
-> approval + execution worker
```

## Code Layout

```text
src/
  cli.ts                  CLI frontend
  server.ts               HTTP API and dashboard server
  worker.ts               Graphile worker entrypoint
  poller.ts               X polling entrypoint
  dashboard.ts            Server-rendered dashboard
  security.ts             API token, body limit, and headers
  visibility.ts           CLI trace formatting
  connectors/
    x-post-resolver.ts    Grok-backed X status resolver

packages/
  ai/                     AI clients, prompts, tools, supervisor agents
  core/                   shared schemas, ids, trace, connector errors
  db/                     Drizzle schema, durable store, in-memory test store
  execution/              venue/webhook execution clients and account state
  market-data/            Hyperliquid and Polymarket discovery
  research/               query planner, evidence ledger, web/X lanes
  risk/                   deterministic risk checks
  workflows/              product facade, Graphile jobs, X polling/webhook helpers
```

`src` is runtime surface. Package-owned implementation lives under `packages`.

## Control Plane

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
load_context
classify_intent
interpret_signal
extract_thesis
extract_inverse_thesis
research_thesis
critique_thesis
plan_trade_expression
select_market
evaluate_risk
create_trade_ticket
finalize_response
```

The supervisor never receives a direct order-placement tool. It can create a trade ticket only after market selection and deterministic risk evaluation.

## Model Routing

Cassie separates mechanical research bookkeeping from analyst judgment.

```text
Cheap model: DeepSeek v4 Flash through the DeepSeek AI SDK
Mini search operator: Gemini 3.1 Flash Lite through the Google AI SDK with Google Search grounding
Important model: GPT-5.5 for judgment, goal resolution, critique, synthesis, and trade expression
X search: Grok 4.3 with image/video understanding
```

Cheap models handle extraction, tagging, and structured bookkeeping. Search lanes emit evidence ledgers directly. GPT-5.5 handles what matters, what would disprove the thesis, whether evidence is enough, whether to stop, and whether a trade is justified.

## Research

Research is goal-first and evidence-ledger based.

```text
signal + thesis
-> query plan
-> query jobs
-> web/X query execution
-> SearchResult[]
-> EvidenceClaim[]
-> GoalEvidenceLink[]
-> GoalResolution[]
-> ResearchReport
```

Every query job maps to one or more research goals. Web and X search are mandatory lanes, but X social evidence is not treated as factual proof unless the goal is social provenance or momentum.

## Trading

The trading path is intentionally split.

```text
research report
-> trade-expression planner
-> market selector
-> deterministic risk check
-> trade ticket
-> approval state
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
research reports
trade tickets
execution jobs
runtime state
audit events
```

Graphile Worker owns background execution for supervisor runs and trade-ticket execution jobs.
