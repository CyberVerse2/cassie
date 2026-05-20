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

## Tools

Cassie should use bounded tools. The supervisor decides when to call them, but each tool owns one clear job.

```text
get-source-post
get-user-settings
intent-router
thesis
inverse-thesis
research
critique
market
risk-check
create-trade
request-approval
write-audit-event
```

The tools should be explicit enough that Cassie can compose them, inspect their outputs, and stop before execution.

```text
get-source-post -> loads the post, quote context, author, media, links, timestamp
get-user-settings -> loads risk settings, venues, asset permissions, default size
intent-router -> classifies the mention into a supported Cassie mode
thesis -> extracts the market claim from the post and command
inverse-thesis -> turns the thesis into the strongest opposing trade idea
research -> gathers context, evidence, contradiction, and source credibility
critique -> attacks the thesis and decides whether it is weak, crowded, stale, or fadeable
market -> finds the best trade expression for the thesis
risk-check -> deterministically approves, rejects, or requires approval
create-trade -> creates a trade ticket
request-approval -> sends an approval request for a ticket
write-audit-event -> records every agent, tool, risk, and ticket decision
```

Do not give the supervisor a direct `place-order` tool. Cassie creates trade tickets; execution belongs to a separate approved execution workflow.

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

This is used for:

```text
@Cassie what do you think?
@Cassie critic this
@Cassie tear this apart
@Cassie fade this
@Cassie get me in
@Cassie trade this
@Cassie countertrade this
```

It should identify:

```text
Does the user want analysis only?
Does the user want criticism?
Does the user want a trade ticket?
Does the user want the opposite trade?
Did the user mention a specific asset, venue, or size?
Is the command ambiguous enough to reject or ask for clarification?
```

```ts
type CassieIntent = "think" | "critic" | "trade" | "countertrade";
```

The router should be AI-based, not keyword-based. If the AI dependency is unavailable, the route should fail clearly instead of silently downgrading to regex or term matching.

## Thesis

The thesis tool extracts the core market claim from the source post and user command.

This is used for:

```text
@Cassie what do you think?
@Cassie find the trade
@Cassie trade this
@Cassie critic this
```

It should answer:

```text
What is the post actually claiming?
What would need to happen for the post to be right?
What asset, market, or event is affected?
Is the thesis bullish, bearish, neutral, or unclear?
What time horizon does the thesis imply?
Is the claim evidence-backed or vibes-only?
```

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

This is used for:

```text
@Cassie countertrade this
@Cassie fade this
@Cassie what is the opposite trade?
```

It should answer:

```text
What would make the original thesis wrong?
What is the cleanest opposing view?
Is the opposite trade actually tradable?
Is the inverse thesis stronger than the original?
What market expression best captures the inverse?
```

It should return:

- original thesis
- inverse thesis
- inverse direction
- relevant assets
- market category
- time horizon
- confidence

## Research

The research tool is backed by the Research Subagent described in [research-subagent.md](research-subagent.md).

It gathers supporting and opposing context for analysis, critique, trade, and countertrade flows. It verifies whether a claim is real, current, credible, contradicted, socially crowded, manipulated, or too uncertain to continue.

This is used for:

```text
@Cassie what do you think?
@Cassie critic this
@Cassie tear this apart
@Cassie is this real?
@Cassie get me in
@Cassie fade this
@Cassie find me a market
```

It should search for:

```text
Is the source credible?
Is there confirming evidence?
Is there contradictory evidence?
Is the news old?
Is the claim missing context?
Is the post engagement-bait or market manipulation?
Are there relevant links, screenshots, filings, prices, or market moves?
```

It should return:

- structured ResearchReport
- source credibility
- confirming evidence
- contradicting evidence
- bull case
- bear case
- missing context
- manipulation risk
- stale-news risk
- recommended research action

## Critique

The critique tool evaluates the thesis after research.

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

It should return:

- strongest objection
- secondary objections
- whether the thesis is tradable
- whether fading the thesis is cleaner
- final critique

## Market

The market tool finds the best expression for a thesis.

This is used for:

```text
@Cassie find me a market
@Cassie get me in
@Cassie trade this
@Cassie countertrade this
```

It should consider:

- perps
- spot
- prediction markets
- options
- no trade

It should call market-data tools like:

```text
find-hyperliquid-markets
find-polymarket-markets
find-token-markets
find-options-markets
get-order-book
get-funding
get-liquidity
get-spread
```

It should decide:

```text
Is there a direct market?
Is the prediction market cleaner than the token trade?
Is the perp more liquid than spot?
Is the market too illiquid?
Is the spread too wide?
Is the trade too indirect?
Is no trade the best answer?
```

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

This is used for:

```text
think -> after market selection, to decide whether the idea is tradable
trade -> before create-trade
countertrade -> before create-trade
```

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

This is used for:

```text
@Cassie trade this
@Cassie get me in
@Cassie countertrade this
@Cassie fade this
```

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
