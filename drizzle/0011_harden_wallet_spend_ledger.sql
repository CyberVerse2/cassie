ALTER TABLE "wallet_spend_ledger_entries"
  ADD COLUMN IF NOT EXISTS "amount_usd_cents" integer;

UPDATE "wallet_spend_ledger_entries"
SET "amount_usd_cents" = round("amount_usd"::numeric * 100)::integer
WHERE "amount_usd_cents" IS NULL;

DELETE FROM "wallet_spend_ledger_entries" ledger
WHERE NOT EXISTS (
  SELECT 1
  FROM "user_settings" settings
  WHERE settings."user_id" = ledger."user_id"
);

DELETE FROM "wallet_spend_ledger_entries" ledger
WHERE ledger."ticket_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "trade_tickets" ticket
    WHERE ticket."ticket_id" = ledger."ticket_id"
  );

DELETE FROM "wallet_spend_ledger_entries" ledger
WHERE ledger."execution_job_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "execution_jobs" job
    WHERE job."job_id" = ledger."execution_job_id"
  );

ALTER TABLE "wallet_spend_ledger_entries"
  ALTER COLUMN "amount_usd_cents" SET NOT NULL;

ALTER TABLE "wallet_spend_ledger_entries"
  DROP CONSTRAINT IF EXISTS "wallet_spend_ledger_amount_nonnegative";

ALTER TABLE "wallet_spend_ledger_entries"
  ADD CONSTRAINT "wallet_spend_ledger_amount_cents_nonnegative"
  CHECK ("amount_usd_cents" >= 0);

DROP INDEX IF EXISTS "wallet_spend_ledger_execution_type_unique_idx";
CREATE UNIQUE INDEX "wallet_spend_ledger_execution_type_unique_idx"
  ON "wallet_spend_ledger_entries" ("execution_job_id", "type")
  WHERE "execution_job_id" IS NOT NULL;

ALTER TABLE "wallet_spend_ledger_entries"
  DROP CONSTRAINT IF EXISTS "wallet_spend_ledger_user_fk";

ALTER TABLE "wallet_spend_ledger_entries"
  ADD CONSTRAINT "wallet_spend_ledger_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "user_settings" ("user_id")
  ON DELETE CASCADE;

ALTER TABLE "wallet_spend_ledger_entries"
  DROP CONSTRAINT IF EXISTS "wallet_spend_ledger_ticket_fk";

ALTER TABLE "wallet_spend_ledger_entries"
  ADD CONSTRAINT "wallet_spend_ledger_ticket_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "trade_tickets" ("ticket_id")
  ON DELETE CASCADE;

ALTER TABLE "wallet_spend_ledger_entries"
  DROP CONSTRAINT IF EXISTS "wallet_spend_ledger_execution_job_fk";

ALTER TABLE "wallet_spend_ledger_entries"
  ADD CONSTRAINT "wallet_spend_ledger_execution_job_fk"
  FOREIGN KEY ("execution_job_id") REFERENCES "execution_jobs" ("job_id")
  ON DELETE CASCADE;

ALTER TABLE "wallet_spend_ledger_entries"
  DROP COLUMN IF EXISTS "amount_usd";
