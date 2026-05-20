CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" text PRIMARY KEY NOT NULL,
  "settings" jsonb NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "mentions" (
  "mention_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "user_command" text NOT NULL,
  "source_post" jsonb NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "runs" (
  "run_id" text PRIMARY KEY NOT NULL,
  "mention_id" text NOT NULL,
  "user_id" text NOT NULL,
  "user_command" text NOT NULL,
  "source_post" jsonb NOT NULL,
  "response_type" text NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "research_reports" (
  "report_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "report" jsonb NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "trade_tickets" (
  "ticket_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "ticket" jsonb NOT NULL,
  "approval_state" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "execution_jobs" (
  "job_id" text PRIMARY KEY NOT NULL,
  "ticket_id" text NOT NULL,
  "job" jsonb NOT NULL,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "entity_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "event_type" text NOT NULL,
  "message" text NOT NULL,
  "data" jsonb,
  "created_at" text NOT NULL
);
