Use a **supervisor + tools + deterministic execution** architecture.

Cassie should not be one giant free-roaming agent. With the Vercel AI SDK, build her as a **ToolLoopAgent-based supervisor** that can call bounded tools, produce structured outputs, and hand trade proposals to a deterministic risk/execution layer.

The architecture:

```text
X/Twitter mention
↓
Intent router
↓
Cassie supervisor agent
↓
Specialist tools/subagents
↓
Structured trade proposal
↓
Risk engine
↓
Trade ticket or execution workflow
↓
Dashboard + audit trail
```

## The core principle

Cassie can **think with AI**, but she should **trade through code**.

So the LLM can decide:

```text
“This post is bullish SOL.”
“Best expression is SOL-PERP long.”
“Confidence is 0.76.”
“Prediction market is less direct.”
```

But the LLM should not directly place orders.

The actual trade flow should be:

```text
LLM proposes
↓
risk engine validates
↓
user/dashboard rules approve or reject
↓
execution service places order
```

That is the architecture that makes Cassie feel powerful without becoming reckless.

## Use AI SDK 6’s `ToolLoopAgent`

Use **Vercel AI SDK 6** and build Cassie around `ToolLoopAgent`. The current AI SDK docs describe agents as LLMs that use tools in a loop, with the LLM deciding next actions, tools extending capabilities, and the loop managing context and stopping conditions. The `ToolLoopAgent` class is the SDK’s main abstraction for this loop. ([AI SDK][1])

Also, in AI SDK 6, `Experimental_Agent` was replaced by `ToolLoopAgent`, and the old `system` parameter became `instructions`. The docs also note that `generateObject` and `streamObject` are deprecated in v6, so use `generateText` / `streamText` with `Output.object()` for structured outputs. ([AI SDK][2])

So the base Cassie agent looks like this:

```ts
import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const cassieAgent = new ToolLoopAgent({
  model: openai("gpt-5.5"),
  instructions: `
You are Cassie, a Twitter-native trading agent.

You can analyze, criticize, find markets, create trade tickets, and propose trades.
You must never directly execute a trade.
You must always respect user risk settings.
If the thesis is vague, manipulated, illiquid, or unsafe, return NO_TRADE.
`,
  stopWhen: stepCountIs(8),
  tools: {
    getSourcePost,
    getUserSettings,
    classifyIntent,
    researchThesis,
    findMarkets,
    scoreMarketCandidates,
    createTradeTicket,
    requestApproval,
  },
});
```

The AI SDK supports multi-step tool calling through `stopWhen`, where the model can call tools, receive tool results, and continue until a stopping condition is reached. That is exactly what Cassie needs for “read post → research → find markets → propose action.” ([AI SDK][3])

## Do not make execution a normal agent tool

Do **not** give Cassie this tool in v1:

```ts
placeOrder()
```

That is dangerous.

Give her these instead:

```ts
createTradeTicket()
requestApproval()
submitApprovedTicketToExecution()
```

The difference matters.

Bad architecture:

```text
LLM → placeOrder()
```

Good architecture:

```text
LLM → createTradeTicket()
risk engine → approve/reject/needs approval
execution service → placeOrder()
```

The AI SDK also supports tool approval patterns, including dynamic approval based on tool input. The docs show a `needsApproval` function that can require approval above a threshold, which maps nicely to Cassie rules like “auto-trade under $50, require approval above $100.” ([AI SDK][3])

## Cassie’s agent architecture

I would use **one supervisor agent** and several **specialist modules**.

Not every specialist needs to be its own full agent. Some can be deterministic tools. Some can be LLM calls with structured output.

```text
Cassie Supervisor Agent
├── Intent Router
├── Thesis Agent
├── Critic Agent
├── Market Router
├── Trade Planner
├── Risk Engine
├── Execution Engine
└── Audit Logger
```

## 1. Intent Router

This runs first.

Its job is to understand what the user meant when tagging Cassie.

Example commands:

```text
@Cassie what do you think?
@Cassie critic this
@Cassie find me a market
@Cassie get me in
@Cassie fade this
@Cassie trade this token
@Cassie trade this Polymarket
```

The router should produce structured JSON.

Use `generateText` with `Output.object()` and Zod schema. The AI SDK docs say structured generation can use Zod/Valibot/JSON Schema through the `output` property, and structured output can be combined with tool calling. ([AI SDK][4])

```ts
import { generateText, Output } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

export const IntentSchema = z.object({
  intent: z.enum([
    "think",
    "critic",
    "find_market",
    "trade",
    "countertrade",
    "specific_trade",
    "unknown",
  ]),
  executionRequested: z.boolean(),
  counterThesis: z.boolean(),
  specificAsset: z.string().nullable(),
  specificVenue: z
    .enum(["hyperliquid", "polymarket", "deribit", "jupiter", "unknown"])
    .nullable(),
  userSizeOverrideUsd: z.number().nullable(),
  confidence: z.number().min(0).max(1),
});

export async function classifyCassieIntent(input: {
  userCommand: string;
  sourcePostText: string;
}) {
  const { output } = await generateText({
    model: openai("gpt-5.5"),
    output: Output.object({ schema: IntentSchema }),
    prompt: `
Classify the user's Cassie command.

User command:
${input.userCommand}

Source post:
${input.sourcePostText}
`,
  });

  return output;
}
```

The intent router should be cheap, fast, and strict.

## 2. Cassie Supervisor Agent

The supervisor decides which tools to call after intent classification.

For example:

```text
think → thesis only
critic → thesis + research + criticism
find_market → thesis + market search + market scoring
trade → thesis + market search + risk check + ticket/execution
countertrade → inverse thesis + market search + risk check + ticket/execution
specific_trade → resolve asset/venue + risk check + ticket/execution
```

Pseudo-flow:

```ts
export async function runCassieAgent(input: {
  mentionId: string;
  userId: string;
  sourcePostId: string;
}) {
  const result = await cassieAgent.generate({
    prompt: `
Process this Cassie mention.

Mention ID: ${input.mentionId}
User ID: ${input.userId}
Source post ID: ${input.sourcePostId}

Follow this order:
1. Load source post.
2. Load user settings.
3. Classify intent.
4. If analysis-only, produce response.
5. If trading-related, find markets.
6. Create a trade proposal.
7. Never execute directly.
8. Create ticket or request approval.
`,
  });

  return result;
}
```

## 3. Thesis Agent

This extracts the actual trade thesis from the post.

Input:

```text
Tweet/post
User command
Post author
Timestamp
Quote context
Links/images if available
```

Output:

```ts
const ThesisSchema = z.object({
  thesis: z.string(),
  direction: z.enum(["bullish", "bearish", "neutral", "unclear"]),
  assets: z.array(z.string()),
  topics: z.array(z.string()),
  timeHorizon: z.enum(["intraday", "days", "weeks", "months", "event_based", "unclear"]),
  evidenceQuality: z.enum(["strong", "medium", "weak", "unknown"]),
  manipulationRisk: z.enum(["low", "medium", "high"]),
  shouldResearch: z.boolean(),
});
```

Example output:

```json
{
  "thesis": "The post implies SOL should rally because of a possible ETF approval.",
  "direction": "bullish",
  "assets": ["SOL"],
  "topics": ["Solana ETF", "crypto ETF approval"],
  "timeHorizon": "event_based",
  "evidenceQuality": "weak",
  "manipulationRisk": "medium",
  "shouldResearch": true
}
```

## 4. Critic Agent

This is used for:

```text
@Cassie critic this
@Cassie tear this apart
@Cassie fade this
@Cassie countertrade this
```

It should search for weaknesses:

```text
Is the source credible?
Is the news already priced in?
Is the market already crowded?
Is the ticker ambiguous?
Is liquidity bad?
Is this a pump?
Is the opposite trade cleaner?
```

Output:

```ts
const CriticSchema = z.object({
  mainWeaknesses: z.array(z.string()),
  counterThesis: z.string(),
  credibilityScore: z.number().min(0).max(1),
  crowdednessRisk: z.enum(["low", "medium", "high"]),
  recommendation: z.enum(["support_thesis", "fade_thesis", "no_trade"]),
});
```

For “fade this,” the critic output feeds the market router.

## 5. Market Router

This is one of the most important parts.

Cassie needs to decide the best trade expression:

```text
Perp?
Spot?
Token?
Prediction market?
Option?
No trade?
```

The market router should call tools like:

```ts
findHyperliquidMarkets()
findPolymarketMarkets()
findTokenMarkets()
findOptionsMarkets()
getOrderBook()
getFunding()
getLiquidity()
getSpread()
```

The LLM can help rank candidates, but the data should come from deterministic connectors.

Candidate schema:

```ts
const MarketCandidateSchema = z.object({
  venue: z.enum(["hyperliquid", "polymarket", "deribit", "jupiter", "zero_x"]),
  instrumentType: z.enum(["perp", "spot", "token", "prediction_market", "option"]),
  symbol: z.string(),
  side: z.enum(["long", "short", "buy_yes", "buy_no", "buy", "sell"]),
  matchReason: z.string(),
  liquidityScore: z.number().min(0).max(1),
  thesisFitScore: z.number().min(0).max(1),
  riskScore: z.number().min(0).max(1),
});
```

Final selection:

```ts
const TradeProposalSchema = z.object({
  action: z.enum(["analysis_only", "create_ticket", "execute_if_allowed", "no_trade"]),
  thesis: z.string(),
  selectedCandidate: MarketCandidateSchema.nullable(),
  rejectedCandidates: z.array(
    z.object({
      symbol: z.string(),
      venue: z.string(),
      reason: z.string(),
    })
  ),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
```

## 6. Risk Engine

This should **not** be an LLM.

This should be deterministic TypeScript.

Input:

```text
trade proposal
user settings
current positions
open orders
daily loss
asset whitelist
venue whitelist
liquidity
spread
slippage
leverage
confidence
```

Output:

```ts
type RiskDecision =
  | { decision: "approve_auto"; adjustedSizeUsd: number }
  | { decision: "require_approval"; reason: string }
  | { decision: "reject"; reason: string }
  | { decision: "create_ticket_only"; reason: string };
```

Example:

```ts
export function evaluateRisk(input: {
  proposal: TradeProposal;
  userSettings: UserRiskSettings;
  accountState: AccountState;
  marketState: MarketState;
}): RiskDecision {
  const { proposal, userSettings, accountState, marketState } = input;

  if (!proposal.selectedCandidate) {
    return { decision: "reject", reason: "No valid market candidate selected." };
  }

  if (!userSettings.allowedVenues.includes(proposal.selectedCandidate.venue)) {
    return { decision: "reject", reason: "Venue not enabled by user." };
  }

  if (proposal.confidence < userSettings.minAutoTradeConfidence) {
    return {
      decision: "create_ticket_only",
      reason: "Confidence below auto-trade threshold.",
    };
  }

  if (marketState.spreadBps > userSettings.maxSpreadBps) {
    return { decision: "reject", reason: "Spread too wide." };
  }

  if (accountState.dailyLossUsd >= userSettings.maxDailyLossUsd) {
    return { decision: "reject", reason: "Daily loss limit reached." };
  }

  const size = Math.min(
    userSettings.defaultTradeSizeUsd,
    userSettings.maxTradeSizeUsd
  );

  if (!userSettings.autoTradeEnabled) {
    return { decision: "require_approval", reason: "Auto-trade disabled." };
  }

  return { decision: "approve_auto", adjustedSizeUsd: size };
}
```

This is the layer that protects users from bad AI decisions.

## 7. Execution Engine

Execution should be a separate service, not a Vercel route handler.

Use a durable queue/workflow:

```text
Temporal preferred
BullMQ acceptable for MVP
```

The execution engine receives an already-approved ticket:

```ts
type ApprovedTradeTicket = {
  ticketId: string;
  userId: string;
  venue: "hyperliquid" | "polymarket";
  symbol: string;
  side: string;
  sizeUsd: number;
  orderType: "limit" | "marketable_limit";
  maxSlippageBps: number;
  stopLoss?: StopLossConfig;
  takeProfit?: TakeProfitConfig;
};
```

Then it does:

```text
re-check user settings
re-check account balance
re-check market price
re-check slippage
place order
monitor fill
attach stop/take-profit if needed
write audit events
notify user
```

Important: even if Cassie already checked risk, the execution engine should check again. Prices move.

## 8. Memory architecture

Use memory for user preferences and prior Cassie decisions, not for raw trading authority.

The AI SDK docs describe memory as letting an agent save and recall information over time, and list provider-defined tools, memory providers, and custom tools as approaches. ([AI SDK][5])

For Cassie, use **custom memory** backed by Postgres/pgvector.

Memory categories:

```text
User trading preferences
Past Cassie trades
Rejected trade patterns
Asset aliases
User-specific command habits
Prior thesis outcomes
```

Example memory tool:

```ts
const getUserTradingMemory = tool({
  description: "Fetch user-specific Cassie trading preferences and past behavior.",
  inputSchema: z.object({
    userId: z.string(),
  }),
  execute: async ({ userId }) => {
    return db.userMemory.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
  },
});
```

Do **not** let memory override dashboard rules.

Bad:

```text
“User often trades SOL, so auto-trade SOL.”
```

Good:

```text
“User often asks about SOL, but dashboard rules still decide whether execution is allowed.”
```

## 9. Human approval architecture

There are three approval states:

```text
analysis_only
ticket_created
approved_for_execution
```

The dashboard should show pending tickets.

For AI SDK UI, you can use streamed tool state for frontend visibility, but the actual trade approval should be recorded server-side in your database.

Approval flow:

```text
Cassie creates trade ticket
↓
dashboard displays ticket
↓
user clicks Approve
↓
server verifies user owns ticket
↓
risk engine re-runs
↓
execution job is created
```

For small trades, if the user has enabled auto-trading:

```text
Cassie creates trade ticket
↓
risk engine approves auto
↓
execution job starts
↓
dashboard marks trade as auto-executed under rule X
```

## 10. Recommended file structure

```text
apps/
  web/
    app/
      dashboard/
      api/
        cassie/
          mention/route.ts
          chat/route.ts
          approve-ticket/route.ts

  workers/
    x-ingest-worker/
    cassie-agent-worker/
    execution-worker/
    market-data-worker/

packages/
  ai/
    agents/
      cassie-supervisor.ts
      intent-router.ts
      thesis-agent.ts
      critic-agent.ts
      market-router.ts
    tools/
      get-source-post.ts
      get-user-settings.ts
      research-thesis.ts
      find-markets.ts
      create-ticket.ts
      request-approval.ts
    schemas/
      intent.ts
      thesis.ts
      market-candidate.ts
      trade-proposal.ts

  risk/
    evaluate-risk.ts
    rules.ts

  execution/
    hyperliquid/
    polymarket/
    order-router.ts

  db/
    schema.ts
    queries.ts

  audit/
    write-agent-event.ts
    write-execution-event.ts
```

## 11. How the actual flow works

### User says:

```text
@Cassie get me in
```

### The system does:

```text
1. X mention received.
2. Store mention in database.
3. Queue Cassie agent run.
4. Load source post.
5. Load user settings.
6. Classify command as "trade".
7. Extract thesis.
8. Search markets.
9. Score markets.
10. Produce structured trade proposal.
11. Run risk engine.
12. If approved, create execution job.
13. If not approved, create ticket.
14. Post short reply.
15. Update dashboard.
```

### Cassie public reply:

```text
Trade ticket created.

Thesis: bullish SOL ETF rumor.
Best expression: SOL-PERP long.
Risk: rumor-driven; already moved.

Check dashboard to approve.
```

### Dashboard detail:

```text
Original post: ...
Command: get me in
Thesis: Bullish SOL ETF rumor
Selected market: SOL-PERP on Hyperliquid
Rejected:
- Prediction market: no exact match
- SOL meme tokens: too indirect
- Options: poor liquidity
Size: $50 default
Risk rule: approval required because confidence < 0.80
```

## 12. Use Vercel AI Gateway optionally

For production, I would consider Vercel AI Gateway because it gives a unified API for many models, model/provider switching, budget monitoring, load balancing, and fallbacks. Vercel’s docs say AI Gateway works with AI SDK v5/v6 and supports OpenAI Responses among other APIs. ([Vercel][6])

Recommended model routing:

```text
Intent router: cheaper/fast model
Thesis extraction: fast model
Critic/research: stronger model
Market ranking: stronger model
Final user-facing explanation: strong model
Embeddings: embedding model through AI Gateway or OpenAI provider
```

The OpenAI provider in the AI SDK supports OpenAI responses/chat/completion APIs and embeddings, and the docs say OpenAI Responses is the default OpenAI API used by the provider since AI SDK 5. ([AI SDK][7])

## The final architecture I’d use

```text
CassieAgent = ToolLoopAgent supervisor

Tools:
- getSourcePost()
- getUserSettings()
- classifyIntent()
- extractThesis()
- runCritic()
- findHyperliquidMarkets()
- findPolymarketMarkets()
- findTokenMarkets()
- scoreCandidates()
- createTradeTicket()
- requestApproval()

Not tools:
- risk engine
- execution engine
- order signing
- wallet permissions
- liquidation checks
```

The clean version:

```text
Vercel AI SDK = reasoning, tools, structured outputs, UI streaming
Postgres = memory, tickets, audit trail
Risk engine = deterministic approval/rejection
Execution worker = actual trading
Dashboard = user permissions and approvals
```

For Cassie, the most important rule is:

> **The agent is allowed to propose trades. The system is allowed to execute trades.**
