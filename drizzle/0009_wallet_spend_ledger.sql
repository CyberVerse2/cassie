CREATE TABLE IF NOT EXISTS "wallet_spend_ledger_entries" (
  "entry_id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "amount_usd" real NOT NULL,
  "ticket_id" text,
  "execution_job_id" text,
  "metadata" jsonb,
  "created_at" text NOT NULL,
  CONSTRAINT "wallet_spend_ledger_amount_nonnegative" CHECK ("amount_usd" >= 0)
);

CREATE INDEX IF NOT EXISTS "wallet_spend_ledger_user_created_idx"
  ON "wallet_spend_ledger_entries" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "wallet_spend_ledger_ticket_idx"
  ON "wallet_spend_ledger_entries" ("ticket_id");

CREATE INDEX IF NOT EXISTS "wallet_spend_ledger_execution_job_idx"
  ON "wallet_spend_ledger_entries" ("execution_job_id");
