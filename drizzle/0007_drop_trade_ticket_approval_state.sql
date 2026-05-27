DROP INDEX IF EXISTS "trade_tickets_run_state_idx";
DROP INDEX IF EXISTS "trade_tickets_user_state_idx";

ALTER TABLE "trade_tickets"
  DROP COLUMN IF EXISTS "approval_state";

CREATE INDEX IF NOT EXISTS "trade_tickets_run_idx"
  ON "trade_tickets" ("run_id");

CREATE INDEX IF NOT EXISTS "trade_tickets_user_idx"
  ON "trade_tickets" ("user_id");
