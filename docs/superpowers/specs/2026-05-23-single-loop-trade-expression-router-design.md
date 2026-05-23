# Single-Loop Trade Expression Router Design

## Product Definition

Cassie is a trade-expression router for noisy, untrusted, market-moving posts.

When a user tags Cassie on a post, Cassie should not behave like a ticket clerk and should not start by validating the post as a standalone research task. The product goal is to infer the trade opportunity implied by the post, search supported expression surfaces, choose the cleanest executable expression, apply risk gates, and create a ticket only when the trade clears.

The canonical flow is:

```text
untrusted social post
-> infer the market opportunity
-> generate competing trade expressions
-> search supported venues and markets
-> assess payoff fit and liquidity
-> rank expressions
-> risk check
-> create ticket or finalize no-trade
```

Truth validation is one input into expression ranking. It is not the front door of the agent.

## Core Architecture

Cassie should use one supervisor ToolLoopAgent for the full decision process. The current nested trade-expression loop should be removed.

The supervisor owns the full tool history, including opportunity framing, venue search, market assessment, quote refreshes, expression ranking, risk checks, ticket creation, and finalization. No tool should run another AI-driven tool loop internally.

The trade-expression module should remain as a structured reasoning boundary, but it should expose single-step tools and schemas rather than its own model loop.

## Tool Flow

### `frame_opportunity`

Reads the source post and user command, then frames the market opportunity.

It should identify:

- the literal claim in the post
- why the claim could move markets
- likely affected assets, companies, events, teams, sectors, or venues
- whether the post looks like a noisy or fake market-moving signal
- whether the user is asking to follow, fade, critique, watch, or trade
- the broad family of possible trade expressions

This tool should not choose the final trade.

### `generate_trade_expressions`

Creates a set of candidate expressions for the opportunity.

Examples:

- short BTC perp
- short MSTR or Strategy-linked exposure
- buy YES on a prediction market
- buy NO on a prediction market
- fade the post if it appears fake and the market has overreacted
- no trade if all expressions are too indirect, illiquid, or unavailable

Each expression should include directness, expected payoff purity, likely venue requirements, evidence needed, and known risks.

### `search_venues`

Searches configured execution and market surfaces for real candidates.

Supported surfaces can include:

- Hyperliquid spot, perp, and pre-stock markets
- Polymarket event and probability markets
- future supported surfaces such as sports markets or other prediction markets

This tool must return real candidates only. It must not invent markets, symbols, token IDs, prices, order books, or venue availability.

### `assess_expression_fit`

Checks whether a real candidate actually expresses the intended trade.

For prediction markets, this must inspect resolution semantics, correct side, date bounds, entity naming, and payoff definition. A market title or slug is not enough.

For perps or futures, this must distinguish direct exposure from broad beta or indirect read-through.

### `quote_expression`

Refreshes market data for promising candidates.

It should return price, spread, slippage estimate, liquidity, and venue-specific identifiers needed for ticket creation.

### `rank_expressions`

Ranks the available expressions using:

- directness to the post
- payoff purity
- liquidity
- spread and slippage
- venue support
- fake-headline or rumor risk
- timing
- expected edge
- user settings and risk constraints

The output should choose the best real expression or explain why there is no clean trade.

### `risk_check`

Runs deterministic code-owned risk checks after a real expression has been selected.

Risk checks include:

- allowed venue
- max spread
- max slippage
- confidence threshold
- requested size and user max size
- available balance
- daily loss limit
- max exposure
- auto-trade setting

### `create_trade_ticket`

Creates a ticket only after risk does not reject the selected expression.

This tool never executes orders.

### `finalize_run`

Writes the final user-facing answer.

The answer should state the cleanest expression, why it was chosen, what risk or fit issues remain, and whether a ticket was created.

## Example: Saylor / Strategy Bitcoin Sale Post

Source post:

```text
BREAKING: Michael Saylor says 'Strategy' will likely sell Bitcoin this year
```

Cassie should treat this as an untrusted market-moving claim.

### Opportunity Frame

Possible interpretation:

```text
Claim: Strategy or Michael Saylor may sell Bitcoin this year.
Market implication if believed: bearish BTC, bearish Strategy/MSTR-linked exposure, and potentially bearish crypto sentiment.
Fake-headline risk: high because this is a breaking social claim.
```

Possible expression families:

- short BTC perp
- short MSTR or Strategy-linked market if supported
- buy YES on a market resolving to Strategy selling BTC this year
- fade the claim if it looks fake and the market has already overreacted

### Venue Search

Cassie searches configured venues.

Possible results:

```text
BTC perp: available, liquid, indirect.
MSTR/Strategy pre-stock perp: unavailable.
Prediction market on Strategy selling BTC: available but low liquidity.
```

### Expression Assessment

Cassie compares the candidates.

BTC perp is liquid and executable, but it is indirect because BTC has many other drivers.

A direct prediction market is purer if it resolves exactly on Strategy selling Bitcoin, but low liquidity or ambiguous resolution rules can make it unsuitable.

MSTR or Strategy-linked exposure would be direct, but only if an actual supported market exists.

### Ranking Outcome

Possible result:

```text
Cleanest supported expression is short BTC perp, but it is indirect.
No liquid direct Strategy-linked venue was found.
The direct prediction market is a better payoff match but too illiquid for the user's default size.
```

Cassie may create a small prediction-market ticket, create a BTC perp ticket, or finalize no-trade depending on actual liquidity, spread, user settings, and market reaction.

## Design Principle

Cassie should optimize for the best trade expression, not for proving or disproving posts in isolation.

Research, verification, and source-quality checks are valuable when they change trade expression, expected edge, sizing, or whether the post should be faded. They should not become a mandatory pre-trade ritual.

The app should converge on:

```text
one AI supervisor loop
one persisted run-step stream
many bounded connector and deterministic tools
no nested AI loops
```
