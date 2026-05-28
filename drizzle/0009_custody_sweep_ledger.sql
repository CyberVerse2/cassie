CREATE TABLE IF NOT EXISTS "custody_balances" (
  "user_id" text PRIMARY KEY NOT NULL,
  "available_usd" real NOT NULL,
  "reserved_usd" real NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "custody_balances_available_nonnegative" CHECK ("available_usd" >= 0),
  CONSTRAINT "custody_balances_reserved_nonnegative" CHECK ("reserved_usd" >= 0)
);

CREATE TABLE IF NOT EXISTS "custody_ledger_entries" (
  "entry_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "amount_usd" real NOT NULL,
  "ticket_id" text,
  "execution_job_id" text,
  "source" text,
  "external_ref" text,
  "metadata" jsonb,
  "created_at" text NOT NULL,
  CONSTRAINT "custody_ledger_amount_nonnegative" CHECK ("amount_usd" >= 0)
);

CREATE INDEX IF NOT EXISTS "custody_ledger_user_created_idx"
  ON "custody_ledger_entries" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "custody_ledger_ticket_idx"
  ON "custody_ledger_entries" ("ticket_id");

CREATE INDEX IF NOT EXISTS "custody_ledger_execution_job_idx"
  ON "custody_ledger_entries" ("execution_job_id");
