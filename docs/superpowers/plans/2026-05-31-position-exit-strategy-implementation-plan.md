# Position Exit Strategy Implementation Plan

Spec: `docs/superpowers/specs/2026-05-31-position-exit-strategy-design.md`

## Goal

Build Cassie's position source of truth, required exit plans, daily Telegram updates, dashboard position views, user-confirmed close actions, and withdrawals.

## Change Set 1: Backend Position System

### 1. Extend Core Schemas

Files:

- `packages/core/schemas/index.ts`
- `tests/schema-normalization.test.ts`
- `tests/execution.test.ts`
- `tests/store.test.ts`

Tasks:

- Add `TradeExitPlanSchema`.
- Add required `exitPlan` to `TradeTicketSchema`.
- Add `PositionSchema`, `PositionReviewSchema`, and `WithdrawalSchema`.
- Add status enums:
  - `PositionStatus`: `open`, `closing`, `closed`, `close_failed`
  - `PositionReviewStatus`: `succeeded`, `failed`
  - `ExitSignal`: `none`, `take_profit`, `stop_loss`, `max_hold`, `thesis_invalidated`
  - `WithdrawalStatus`: `queued`, `running`, `succeeded`, `failed`
- Export all new inferred types.
- Update existing tests and fixtures that create trade tickets so every valid ticket includes an exit plan.
- Add tests that reject tickets without an exit plan.

Verification:

- `npm run build`
- `npm run test -- tests/schema-normalization.test.ts tests/execution.test.ts tests/store.test.ts`

### 2. Add Persistence

Files:

- `packages/core/db/schema.ts`
- `packages/core/db/store.ts`
- `packages/core/db/drizzle-store.ts`
- `drizzle/0012_position_exit_strategy.sql`
- `drizzle/meta/_journal.json`
- `tests/store.test.ts`

Tasks:

- Add `positions`, `position_reviews`, and `withdrawals` tables.
- Add indexes for:
  - positions by `userId`, `status`, `openedAt`
  - positions by `ticketId`
  - positions by `executionJobId`
  - position reviews by `positionId`, `reviewedAt`
  - withdrawals by `userId`, `status`, `createdAt`
- Add foreign keys to user settings, trade tickets, and execution jobs.
- Add store methods:
  - `addPosition`
  - `updatePosition`
  - `getPosition`
  - `getPositionByExecutionJob`
  - `listOpenPositions`
  - `listUserPositions`
  - `addPositionReview`
  - `getLatestPositionReview`
  - `listPositionReviews`
  - `addWithdrawal`
  - `updateWithdrawal`
  - `getWithdrawal`
  - `listUserWithdrawals`
- Implement methods in `InMemoryCassieStore`.
- Implement methods in `DrizzleCassieStore`.
- Add store tests for CRUD, ordering, and idempotent position lookup by execution job.

Verification:

- `npm run build`
- `npm run test -- tests/store.test.ts`

### 3. Create Positions After Execution

Files:

- `packages/jobs/execution-job.ts`
- `packages/jobs/state.ts`
- `tests/execution.test.ts`

Tasks:

- Validate `ticket.exitPlan` before reserving wallet spend.
- After `markExecutionSucceeded`, create a position when `filledSizeUsd > 0`.
- Store entry price from `executionResult.averagePrice`.
- Store entry size and filled size from ticket and execution result.
- Initialize current mark/value/P/L from entry data.
- Make position creation idempotent by checking `executionJobId`.
- Do not create a position for zero fills.
- Audit position creation.

Verification:

- `npm run build`
- `npm run test -- tests/execution.test.ts tests/store.test.ts`

### 4. Add Mark Refresh And Daily Review Job

Files:

- `packages/positions/marks.ts`
- `packages/positions/review.ts`
- `packages/jobs/tasks.ts`
- `packages/jobs/worker.ts`
- `packages/jobs/queue.ts`
- `tests/position-review.test.ts`

Tasks:

- Create a `PositionMarkProvider` interface.
- Implement Hyperliquid mark fetching from live mids/metadata.
- Implement Polymarket mark fetching from live market/outcome prices.
- Fail clearly when a venue or instrument cannot be marked.
- Add `reviewOpenPositionsForUser`.
- Add `reviewAllOpenPositions`.
- Calculate:
  - current value
  - unrealized P/L in USD
  - unrealized P/L percentage
  - exit signal from take-profit, stop-loss, max-hold, and invalidation state
- Persist one `position_review` per evaluated position.
- On mark failure, persist a failed review with `failureReason` and leave prior position marks unchanged.
- Add a Graphile task for daily review.

Verification:

- `npm run build`
- `npm run test -- tests/position-review.test.ts`

### 5. Add Telegram Notification Jobs

Files:

- `packages/notifications/telegram.ts`
- `packages/notifications/positions.ts`
- `packages/jobs/tasks.ts`
- `tests/telegram.test.ts`
- `tests/position-notifications.test.ts`

Tasks:

- Add formatters for:
  - evaluating tagged request
  - no trade
  - ticket created
  - trade executed
  - execution failed
  - daily position summary
- Add notification sender functions that require connected Telegram settings.
- Record notification send failures as audit events.
- Send execution lifecycle notifications from existing run/execution touchpoints.
- Send daily summaries after review job completes for connected users.

Verification:

- `npm run build`
- `npm run test -- tests/telegram.test.ts tests/position-notifications.test.ts`

### 6. Add Close Position Job

Files:

- `packages/positions/close.ts`
- `packages/execution/index.ts`
- `packages/jobs/tasks.ts`
- `packages/jobs/queue.ts`
- `tests/close-position.test.ts`

Tasks:

- Add a focused close-position executor.
- For Hyperliquid, submit the opposite reduce-only close order.
- For Polymarket, sell the held outcome token.
- Add `queueClosePosition`.
- Transition position:
  - `open` or `close_failed` to `closing`
  - `closing` to `closed` on success
  - `closing` to `close_failed` on failure
- Store close execution result and `closedAt`.
- Surface real venue errors.

Verification:

- `npm run build`
- `npm run test -- tests/close-position.test.ts tests/execution.test.ts`

### 7. Add Withdrawal Job

Files:

- `packages/withdrawals/index.ts`
- `packages/jobs/tasks.ts`
- `packages/jobs/queue.ts`
- `tests/withdrawals.test.ts`

Tasks:

- Add withdrawable balance calculation.
- Add `queueWithdrawal`.
- Validate amount and destination address.
- Execute Privy transfer to destination.
- Transition withdrawal:
  - `queued` to `running`
  - `running` to `succeeded` with transfer id
  - `running` to `failed` with real failure
- Ensure open reservations, pending withdrawals, and unsettled close jobs cannot be double-spent.

Verification:

- `npm run build`
- `npm run test -- tests/withdrawals.test.ts tests/store.test.ts`

## Change Set 2: Dashboard Position UI

### 8. Add Dashboard APIs

Files:

- `apps/web/app/api/positions/route.ts`
- `apps/web/app/api/positions/[positionId]/close/route.ts`
- `apps/web/app/api/position-reviews/route.ts`
- `apps/web/app/api/withdrawals/route.ts`
- `apps/web/app/api/account/route.ts`
- `tests/dashboard-api.test.ts`

Tasks:

- Add authenticated `GET /api/positions`.
- Add authenticated `POST /api/positions/[positionId]/close`.
- Add authenticated `GET /api/position-reviews`.
- Add authenticated `POST /api/withdrawals`.
- Add authenticated `GET /api/withdrawals`.
- Extend account response with withdrawable balance.
- Return clear HTTP errors for missing auth, invalid position ownership, invalid amount, invalid destination, and failed queueing.

Verification:

- `npm run build`
- `npm run test -- tests/dashboard-api.test.ts`

### 9. Replace Static Dashboard Position Data

Files:

- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/dashboard/dashboard.module.css`
- `apps/web/app/lib/use-cassie-account.ts`
- `tests/dashboard-api.test.ts`

Tasks:

- Fetch positions from the new API.
- Render open positions from persisted data.
- Render closed positions from persisted data.
- Show latest review and exit signal per position.
- Show exit plan details.
- Keep loading, empty, and error states explicit.
- Remove static production position arrays from the dashboard position views.
- Cover the dashboard data mapping through API tests and verify rendering with `npm run web:build`.

Verification:

- `npm run build`
- `npm run web:build`

### 10. Add Close And Withdraw UI

Files:

- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/dashboard/dashboard.module.css`

Tasks:

- Add close-position action for open and close-failed positions.
- Require explicit user confirmation before close.
- Reflect queued, closing, closed, and close-failed states from persisted data.
- Add withdrawal form.
- Validate amount and destination before calling API.
- Show withdrawal history and current status.
- Show API errors plainly.

Verification:

- `npm run build`
- `npm run web:build`

## Final Verification

Run:

- `npm run build`
- `npm run test`
- `npm run web:build`

Manual smoke checks:

- Create a trade ticket with an exit plan.
- Execute a filled trade in test harness.
- Confirm an open position is created.
- Run daily review and confirm P/L plus exit signal.
- Confirm Telegram formatter output for daily summary.
- Queue a close and confirm closed or close-failed state.
- Queue a withdrawal and confirm durable status.
- Open dashboard and confirm positions are API-backed.

## Commit Strategy

Commit after each coherent production-ready slice:

1. Core schemas and persistence.
2. Position creation and execution integration.
3. Daily review and Telegram notifications.
4. Close and withdrawal jobs.
5. Dashboard APIs.
6. Dashboard UI.

Each commit must pass the verification listed for its slice before moving on.
