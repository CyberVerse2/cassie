# Cassie

Cassie is a Twitter/X-native trading agent. She routes a mention into one of four modes, researches the claim when needed, finds market candidates, runs deterministic risk checks, creates trade tickets, and sends approved tickets to an execution webhook.

Cassie can reason with AI, but she does not directly place orders.

## Run

```bash
npm install
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
OPENAI_API_KEY
XAI_API_KEY
EXECUTION_WEBHOOK_URL
```

Missing database, AI/search, or execution credentials fail clearly. Cassie does not downgrade semantic routing, research, persistence, or execution into local keyword behavior or fake fills.

Run migrations:

```bash
npm run db:migrate
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
    "allowedAssets": ["SOL"],
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

Process a mention:

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

Approve a ticket:

```bash
curl -X POST http://localhost:3000/api/tickets/TICKET_ID/approve \
  -H "Authorization: Bearer $CASSIE_API_TOKEN" \
  -H "Content-Type: application/json"
```

Process one queued execution job:

```bash
curl -X POST http://localhost:3000/api/execution/process \
  -H "Authorization: Bearer $CASSIE_API_TOKEN" \
  -H "Content-Type: application/json"
```

Inspect state:

```bash
curl http://localhost:3000/api/state
```

## Product Surface

Implemented:

- AI intent routing for `think`, `critic`, `trade`, and `countertrade`
- AI thesis and inverse-thesis extraction
- Research subagent workflow with OpenAI web search and Grok X search lanes
- Hyperliquid and Polymarket market-data connectors
- AI market selection from real connector candidates
- Deterministic risk checks
- Trade-ticket creation
- Approval endpoint
- Execution webhook workflow
- Drizzle/Postgres persistence for mentions, runs, research reports, tickets, execution jobs, and audit events
- Dashboard for pending tickets, runs, and audit trail

Not included:

- Hosted database migrations
