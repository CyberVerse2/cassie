CREATE TABLE IF NOT EXISTS "portfolio_balance_snapshots" (
  "snapshot_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "at" text NOT NULL,
  CONSTRAINT "portfolio_balance_snapshots_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "user_settings" ("user_id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "portfolio_balance_snapshots_user_at_idx"
  ON "portfolio_balance_snapshots" ("user_id", "at");
