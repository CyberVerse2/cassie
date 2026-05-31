CREATE TABLE IF NOT EXISTS "positions" (
  "position_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "ticket_id" text NOT NULL,
  "execution_job_id" text NOT NULL,
  "status" text NOT NULL,
  "position" jsonb NOT NULL,
  "opened_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "positions_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "user_settings" ("user_id")
    ON DELETE CASCADE,
  CONSTRAINT "positions_ticket_fk"
    FOREIGN KEY ("ticket_id") REFERENCES "trade_tickets" ("ticket_id")
    ON DELETE CASCADE,
  CONSTRAINT "positions_execution_job_fk"
    FOREIGN KEY ("execution_job_id") REFERENCES "execution_jobs" ("job_id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "positions_user_status_opened_idx"
  ON "positions" ("user_id", "status", "opened_at");

CREATE INDEX IF NOT EXISTS "positions_ticket_idx"
  ON "positions" ("ticket_id");

CREATE UNIQUE INDEX IF NOT EXISTS "positions_execution_job_unique_idx"
  ON "positions" ("execution_job_id");

CREATE TABLE IF NOT EXISTS "position_reviews" (
  "review_id" text PRIMARY KEY NOT NULL,
  "position_id" text NOT NULL,
  "user_id" text NOT NULL,
  "status" text NOT NULL,
  "review" jsonb NOT NULL,
  "reviewed_at" text NOT NULL,
  CONSTRAINT "position_reviews_position_fk"
    FOREIGN KEY ("position_id") REFERENCES "positions" ("position_id")
    ON DELETE CASCADE,
  CONSTRAINT "position_reviews_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "user_settings" ("user_id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "position_reviews_position_reviewed_idx"
  ON "position_reviews" ("position_id", "reviewed_at");

CREATE INDEX IF NOT EXISTS "position_reviews_user_reviewed_idx"
  ON "position_reviews" ("user_id", "reviewed_at");

CREATE TABLE IF NOT EXISTS "withdrawals" (
  "withdrawal_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "status" text NOT NULL,
  "withdrawal" jsonb NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "withdrawals_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "user_settings" ("user_id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "withdrawals_user_status_created_idx"
  ON "withdrawals" ("user_id", "status", "created_at");
