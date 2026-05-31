# Position Exit Strategy Design

## Goal

Cassie must treat exits as part of every executed trade, not as an afterthought. When Cassie opens a trade, she creates a required exit plan, tracks the resulting position, updates the user daily through Telegram, and shows current position state in the dashboard. Users can close a full position or withdraw available USDC from the dashboard.

This design keeps execution user-confirmed for launch. Cassie recommends and alerts on exit conditions, but does not automatically close positions.

## Current Context

Cassie already has durable runs, trade tickets, execution jobs, wallet spend ledger entries, Telegram connection state, and a dashboard. The current persisted trading model stops at tickets and execution jobs. The dashboard still uses mostly static trade data, so it cannot be the source of truth for open positions, current P/L, or exit status.

The new source of truth is a position layer created after successful execution.

## Scope

Included:

- Required exit plans on trade tickets before execution.
- Open position records created from successful execution jobs.
- Daily mark refresh and P/L calculation for open positions.
- Daily Telegram summaries for connected users.
- Immediate Telegram lifecycle updates for tagged trade requests.
- Dashboard-backed open positions, closed positions, exit plans, daily reviews, and execution history.
- Dashboard actions to close 100% of an open position and withdraw available USDC.
- Tests for schema validation, store behavior, position creation, daily review, close jobs, and notification formatting.

Excluded:

- Automatic exit execution.
- Partial exits.
- Telegram button-based close or withdraw actions.
- Compatibility behavior for historical executions that lack position records.

## Domain Model

### Trade Ticket Exit Plan

`TradeTicket` gains a required `exitPlan` object:

- `takeProfitPct`: positive number, default `10`.
- `stopLossPct`: positive number, default `5`.
- `maxHoldDays`: positive integer, default `7`.
- `reviewCadence`: `daily`.
- `thesis`: plain-English reason the trade exists.
- `invalidationSignals`: list of concrete conditions that would weaken or invalidate the trade.

Execution rejects any ticket without a valid exit plan.

### Position

A new `positions` table stores one record per filled execution:

- `positionId`
- `userId`
- `ticketId`
- `executionJobId`
- `venue`
- `instrument`
- `side`
- `status`: `open`, `closing`, `closed`, `close_failed`
- `entrySizeUsd`
- `filledSizeUsd`
- `entryPrice`
- `currentMarkPrice`
- `currentValueUsd`
- `unrealizedPnlUsd`
- `unrealizedPnlPct`
- `exitPlan`
- `openedAt`
- `lastMarkedAt`
- `closedAt`
- `closeExecutionJobId`
- `failureReason`

Positions are created only after an execution job succeeds with a positive fill. If the venue returns no fill, no position is opened.

### Position Review

A new `position_reviews` table stores daily review snapshots:

- `reviewId`
- `positionId`
- `userId`
- `reviewedAt`
- `status`: `succeeded`, `failed`
- `markPrice`
- `currentValueUsd`
- `unrealizedPnlUsd`
- `unrealizedPnlPct`
- `exitSignal`: `none`, `take_profit`, `stop_loss`, `max_hold`, `thesis_invalidated`
- `summary`
- `failureReason`

The daily review job records a review every time it evaluates an open position. Reviews are the audit trail behind Telegram and dashboard messaging.

### Withdrawals

Dashboard withdrawals use the existing Privy transfer path and wallet-spend balance accounting, with their own durable state:

- `withdrawalId`
- `userId`
- `amountUsd`
- `destinationAddress`
- `status`: `queued`, `running`, `succeeded`, `failed`
- `transferId`
- `failureReason`
- timestamps

Withdrawable balance is spendable USDC after open reservations and unsettled close or withdrawal jobs.

## Data Flow

### Opening A Position

1. User tags Cassie with a trade request.
2. Cassie creates a durable run and sends Telegram: `Cassie is evaluating this trade.`
3. The supervisor creates a trade ticket with an exit plan.
4. Execution validates the exit plan, reserves and prefunds USDC, and places the venue order.
5. On execution success, Cassie creates an open position from the filled result.
6. Cassie sends Telegram: `Trade executed`, including entry, size, exit plan, and next review date.
7. Dashboard reads the new position through an account positions API.

### Daily Position Review

1. A scheduled job loads all open positions.
2. The job fetches a current mark for each venue instrument.
3. Cassie recalculates current value and unrealized P/L.
4. Cassie evaluates the exit plan.
5. Cassie records a position review.
6. Cassie sends one Telegram summary per connected user with open positions and recommended action.

Telegram delivery failures are recorded as notification failures. They do not change position state.

### Closing A Position

1. User clicks `Close position` in the dashboard.
2. Dashboard calls a close-position API.
3. Cassie marks the position `closing` and enqueues a close job.
4. The close job sends the venue-specific opposite order or sell action.
5. On success, Cassie marks the position `closed`, stores close execution data, releases or settles wallet state, and records an audit event.
6. On failure, Cassie marks the position `close_failed` with the real failure message.

Close failures remain visible in the dashboard and Telegram summary until resolved by a successful close attempt.

### Withdrawing USDC

1. User enters an amount and destination in the dashboard.
2. Dashboard calls a withdrawal API.
3. Cassie validates the amount against withdrawable balance.
4. Cassie enqueues and executes the Privy transfer.
5. Cassie records succeeded or failed status with the real transfer result or error.

## Dashboard

The dashboard removes static trade arrays for the production position views. It fetches account-backed data from new APIs.

Primary views:

- Open positions: instrument, side, venue, entry, mark, value, P/L, exit signal, next review.
- Exit plan: take profit, stop loss, max hold, thesis, invalidation signals.
- Reviews: daily snapshots and recommended action.
- Closed positions: realized result and close timestamp.
- Activity: runs, tickets, executions, close jobs, withdrawals.

Actions:

- `Close position`: closes 100% of an open or close-failed position.
- `Withdraw`: sends available USDC to a user-provided address.

The dashboard should surface real failures plainly. It must not imply a close, withdrawal, or notification succeeded before durable state confirms it.

## Telegram

Telegram messages use concise status updates.

Immediate lifecycle messages:

- Evaluating tagged request.
- No trade, with reason.
- Ticket created, with planned size and exit plan.
- Trade executed, with entry, size, exit plan, and next review.
- Execution failed, with the actual failure reason.

Daily summary:

- Total open positions.
- Per-position current value and unrealized P/L.
- Exit signal, if any.
- Recommended action: hold, review, or close in dashboard.

If a user has not connected Telegram, no alternate notification channel is used. Dashboard state remains canonical.

## APIs

New dashboard APIs:

- `GET /api/positions`: open and closed positions with latest review.
- `POST /api/positions/[positionId]/close`: enqueue full close.
- `GET /api/position-reviews`: review history.
- `POST /api/withdrawals`: enqueue USDC withdrawal.
- `GET /api/withdrawals`: withdrawal history.

Existing account APIs continue to provide wallet identity and spendable balance, but should include withdrawable balance once withdrawals exist.

## Components

Backend:

- Schema and migration for positions, reviews, and withdrawals.
- Zod schemas and TypeScript types.
- Store methods for position, review, close, and withdrawal state.
- Position creation from successful execution jobs.
- Venue mark refresh helpers.
- Daily review job.
- Close-position job.
- Withdrawal job.
- Telegram notification formatter and sender.

Frontend:

- Positions API client.
- Dashboard open/closed position views.
- Exit-plan detail UI.
- Close confirmation state.
- Withdrawal form and status list.

## Error Handling

Required failure behavior:

- Missing exit plan blocks execution.
- Missing live mark fails that review item and records the failure; it does not fabricate a mark.
- Telegram delivery failure is recorded and shown in operational logs.
- Close failure leaves the position `close_failed` with the venue or wallet error.
- Withdrawal failure leaves the withdrawal `failed` with the real transfer error.

No keyword, mock, stale, or fallback pricing is allowed for production P/L.

## Testing

Backend tests:

- Trade tickets require valid exit plans.
- Execution success creates one position for one positive fill.
- Execution with zero fill creates no position.
- Daily review calculates P/L and exit signals.
- Mark refresh failure records a failed review with `failureReason` and does not change mark data.
- Close job transitions through `closing` to `closed`.
- Close job failure transitions to `close_failed`.
- Withdrawal validates withdrawable balance and records transfer state.
- Telegram lifecycle and daily summary messages format the expected content.

Frontend tests:

- Dashboard renders API-backed open positions.
- Exit plan details are visible.
- Close action calls the close API and reflects pending/success/failure state.
- Withdrawal form validates amount and destination.

## Implementation Split

### Change Set 1: Backend Position System

Add persistence, schemas, position creation, daily review, close jobs, withdrawal jobs, notification helpers, and backend tests.

### Change Set 2: Dashboard Position UI

Replace static position data with API-backed dashboard views and add close and withdrawal actions.

This split keeps the core source of truth production-ready before the dashboard depends on it.
