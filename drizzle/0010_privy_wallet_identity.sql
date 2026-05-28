ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "privy_user_id" text,
  ADD COLUMN IF NOT EXISTS "privy_wallet_id" text,
  ADD COLUMN IF NOT EXISTS "wallet_address" text;

UPDATE "user_settings"
SET
  "privy_user_id" = "settings" ->> 'privyUserId',
  "privy_wallet_id" = "settings" ->> 'privyWalletId',
  "wallet_address" = "settings" ->> 'walletAddress';

CREATE INDEX IF NOT EXISTS "user_settings_privy_user_idx"
  ON "user_settings" ("privy_user_id");

CREATE INDEX IF NOT EXISTS "user_settings_privy_wallet_idx"
  ON "user_settings" ("privy_wallet_id");

CREATE UNIQUE INDEX IF NOT EXISTS "custody_ledger_sweep_external_ref_idx"
  ON "custody_ledger_entries" ("source", "external_ref")
  WHERE "type" = 'sweep_credit' AND "external_ref" IS NOT NULL;
