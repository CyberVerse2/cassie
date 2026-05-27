DROP INDEX IF EXISTS "trade_tickets_run_state_idx";
DROP INDEX IF EXISTS "trade_tickets_user_state_idx";

ALTER TABLE "trade_tickets"
  DROP COLUMN IF EXISTS "approval_state";

UPDATE "trade_tickets"
SET "ticket" = "ticket" - 'approvalState' - 'riskDecision',
    "updated_at" = now()::text
WHERE "ticket" ?| array['approvalState', 'riskDecision'];

UPDATE "audit_events"
SET "data" = "data" - 'approvalState' - 'riskDecision'
WHERE "entity_type" = 'trade_ticket'
  AND jsonb_typeof("data") = 'object'
  AND "data" ?| array['approvalState', 'riskDecision'];

UPDATE "user_settings"
SET "settings" = "settings"
  - 'allowedVenues'
  - 'maxTradeSizeUsd'
  - 'maxDailyLossUsd'
  - 'maxSpreadBps'
  - 'maxSlippageBps'
  - 'maxPositionUsd'
  - 'autoTradeEnabled',
    "updated_at" = now()::text
WHERE "settings" ?| array[
  'allowedVenues',
  'maxTradeSizeUsd',
  'maxDailyLossUsd',
  'maxSpreadBps',
  'maxSlippageBps',
  'maxPositionUsd',
  'autoTradeEnabled'
];

UPDATE "control_runs"
SET "result" = jsonb_set("result", '{actionState}', '"no_trade"', false),
    "updated_at" = now()::text
WHERE "result" ->> 'actionState' = 'block_trade';

DELETE FROM "run_steps"
WHERE "step_type" = 'risk';
