CREATE TABLE IF NOT EXISTS "user_deposit_addresses" (
  "user_id" text PRIMARY KEY NOT NULL,
  "wallet_set_id" text NOT NULL,
  "circle_wallet_id" text NOT NULL,
  "evm_address" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "user_deposit_addresses_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "user_settings" ("user_id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_deposit_addresses_evm_address_unique_idx"
  ON "user_deposit_addresses" ("evm_address");

ALTER TABLE "wallet_spend_ledger_entries"
  ADD COLUMN IF NOT EXISTS "chain" text,
  ADD COLUMN IF NOT EXISTS "tx_hash" text,
  ADD COLUMN IF NOT EXISTS "log_index" integer,
  ADD COLUMN IF NOT EXISTS "circle_transfer_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_spend_ledger_circle_transfer_unique_idx"
  ON "wallet_spend_ledger_entries" ("circle_transfer_id", "type")
  WHERE "circle_transfer_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_spend_ledger_deposit_tx_unique_idx"
  ON "wallet_spend_ledger_entries" ("chain", "tx_hash", "log_index")
  WHERE "tx_hash" IS NOT NULL;
