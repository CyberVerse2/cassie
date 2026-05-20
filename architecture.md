# Cassie Architecture

Cassie is a Twitter-native trading agent built around a supervisor agent, an AI intent router, specialist tools, deterministic risk checks, and trade-ticket creation.

Cassie can reason with AI, but trading decisions must pass through code.

```text
X/Twitter mention
↓
intent router
↓
supervisor agent
↓
intent-specific tool path
↓
risk check
↓
trade ticket or response
```

## Core Components

```text
supervisor agent
intent router
thesis
inverse thesis
research
critique
market
risk check
create-trade
```

## Intent Paths

```text
think -> thesis + market + risk check
critic -> thesis + research + critique
trade -> thesis + market + risk + create-trade
countertrade -> inversethesis + market + risk + create-trade
```

## Supervisor Agent

The supervisor agent owns the session and chooses the tool path after intent routing.

It should:

- load the source post
- load the user's Cassie settings
- call the intent router
- execute the matching intent path
- return a structured response
- create a trade ticket only when the route requires it

It must not directly place orders.

## Intent Router

The intent router classifies the mention into one of Cassie's supported flows.

```ts
type CassieIntent = "think" | "critic" | "trade" | "countertrade";
```

The router should be AI-based, not keyword-based. If the AI dependency is unavailable, the route should fail clearly instead of silently downgrading to regex or term matching.

## Thesis

The thesis tool extracts the core market claim from the source post and user command.

It should return:

- thesis
- direction
- relevant assets
- market category
- time horizon
- confidence
- evidence quality

## Inverse Thesis

The inverse thesis tool turns the source thesis into the strongest opposing trade idea.

It should return:

- original thesis
- inverse thesis
- inverse direction
- relevant assets
- market category
- time horizon
- confidence

## Research

The research tool gathers supporting and opposing context for critique flows.

It should return:

- source credibility
- confirming evidence
- contradicting evidence
- missing context
- manipulation risk
- stale-news risk

## Critique

The critique tool evaluates the thesis after research.

It should return:

- strongest objection
- secondary objections
- whether the thesis is tradable
- whether fading the thesis is cleaner
- final critique

## Market

The market tool finds the best expression for a thesis.

It should consider:

- perps
- spot
- prediction markets
- options
- no trade

It should return:

- selected market
- venue
- instrument
- side
- liquidity
- spread
- thesis fit
- rejected candidates

## Risk Check

The risk check is deterministic code, not an LLM judgment.

It should evaluate:

- user settings
- venue permissions
- asset permissions
- position limits
- daily loss limits
- liquidity
- spread
- slippage
- confidence threshold

It should return:

- approve
- require approval
- reject
- create ticket only

## Create Trade

The create-trade tool creates a trade ticket from an approved or approval-required proposal.

It should return:

- ticket id
- user id
- thesis
- venue
- instrument
- side
- size
- order type
- risk decision
- approval state

Create-trade must not execute the order directly.
