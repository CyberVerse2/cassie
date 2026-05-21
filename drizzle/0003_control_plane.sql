ALTER TABLE "trade_tickets"
  ADD COLUMN IF NOT EXISTS "run_id" text;

CREATE INDEX IF NOT EXISTS "trade_tickets_run_state_idx"
  ON "trade_tickets" ("run_id", "approval_state");

CREATE TABLE IF NOT EXISTS "control_runs" (
  "run_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "user_command" text NOT NULL,
  "source_post" jsonb NOT NULL,
  "status" text NOT NULL,
  "result" jsonb,
  "error" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "control_runs_user_status_idx"
  ON "control_runs" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "control_runs_updated_idx"
  ON "control_runs" ("updated_at");

CREATE TABLE IF NOT EXISTS "run_steps" (
  "step_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "step_type" text NOT NULL,
  "status" text NOT NULL,
  "input" jsonb,
  "output" jsonb,
  "error" text,
  "model" text,
  "prompt_name" text,
  "prompt_version" text,
  "started_at" text NOT NULL,
  "completed_at" text
);

CREATE INDEX IF NOT EXISTS "run_steps_run_started_idx"
  ON "run_steps" ("run_id", "started_at");

CREATE INDEX IF NOT EXISTS "run_steps_status_idx"
  ON "run_steps" ("status");
