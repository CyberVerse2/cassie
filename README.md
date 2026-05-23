# Cassie

Cassie is an X-native trade-expression and ticketing agent. A mention creates a durable control-plane run, a Graphile Worker supervisor drives bounded AI tools, and approved trade tickets are handed to the execution worker.

Cassie can reason with AI, but she does not directly place orders.

## Agent Architecture

```mermaid
flowchart TD
  User["X mention / API / CLI"] --> Intake["Durable control run"]
  Intake --> Supervisor["Graphile Worker supervisor"]
  Supervisor --> Tools["Bounded AI tools + run steps"]
  Tools --> Router["Trade-expression router"]
  Tools --> Ticket["Trade ticket"]
  Router --> Response["Response / trade candidate / no-trade"]
  Ticket --> Approval["Approval policy"]
  Approval --> Execution["Graphile execution worker"]
  Execution --> Audit["Execution events + audit trail"]
```

Runtime shape:

- Intake is durable first: every mention becomes a `control_run` before the supervisor starts.
- The supervisor is the control plane: it calls bounded tools and writes visible `run_steps`.
- Cassie treats the source post as raw verifiable signal, frames the opportunity, generates trade expressions, searches supported venues, ranks the cleanest real expression, and finalizes a ticket or no-trade.
- DeepSeek handles cheap extraction, bookkeeping, analyst judgment, and trade decisions.
- Ticket creation is downstream of market fit, approval policy, and deterministic risk.
- Full supervisor and model-routing details live in `architecture.md`.

## Run

```bash
npm install
npm run db:migrate
npm run dev
```

Dashboard:

```text
http://localhost:3000/dashboard
```

## Configuration

Copy `.env.example` to `.env` and set:

```text
DATABASE_URL
CASSIE_API_TOKEN
DEEPSEEK_API_KEY
OPENAI_API_KEY
GEMINI_API_KEY
XAI_API_KEY
EXECUTION_WEBHOOK_URL
```

Missing database, AI, market, or execution credentials fail clearly. Cassie does not downgrade semantic routing, persistence, or execution into local keyword behavior or fake fills.

Run the worker in a second terminal:

```bash
npm run worker
```

## API

Create or update user settings:

```bash
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_1",
    "walletAddress": "0x0000000000000000000000000000000000000000",
    "allowedVenues": ["hyperliquid", "polymarket"],
    "defaultTradeSizeUsd": 50,
    "maxTradeSizeUsd": 100,
    "maxDailyLossUsd": 100,
    "minConfidence": 0.75,
    "maxSpreadBps": 50,
    "maxSlippageBps": 100,
    "maxPositionUsd": 1000,
    "autoTradeEnabled": false
  }'
```

Create a queued mention run:

```bash
curl -X POST http://localhost:3000/api/mentions \
  -H "Authorization: Bearer $CASSIE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_1",
    "userCommand": "@Cassie get me in",
    "sourcePost": {
      "platform": "x",
      "postId": "post_1",
      "url": "https://x.com/example/status/post_1",
      "authorHandle": "example",
      "authorName": "Example",
      "text": "Solana ETF approval is basically inevitable now. Market is asleep.",
      "createdAt": null
    }
  }'
```

Enqueue Cassie from the CLI and show the live timeline:

```bash
npm run cli -- run --user local-user --post "Solana ETF approval is basically inevitable now. Market is asleep."
```

Inspect an existing run:

```bash
npm run cli -- control-run RUN_ID --json
```

Approve a ticket:

```bash
curl -X POST http://localhost:3000/api/tickets/TICKET_ID/approve \
  -H "Authorization: Bearer $CASSIE_API_TOKEN" \
  -H "Content-Type: application/json"
```

Inspect state:

```bash
curl http://localhost:3000/api/state
```

## Product Surface

Implemented:

- Single-loop AI supervisor for trade-expression routing
- Opportunity framing for raw verifiable social signals
- AI trade-expression generation and ranking
- Polymarket market discovery using the documented market/search surfaces indexed in `docs/llms/`
- Hyperliquid and Polymarket adapters over real connector candidates
- Deterministic risk checks
- Trade-ticket creation
- Approval endpoint
- Graphile Worker supervisor and execution jobs
- Drizzle/Postgres persistence for mentions, control runs, run steps, tickets, execution jobs, and audit events
- Dashboard for pending tickets, runs, and audit trail

Not included:

- Hosted database migrations
