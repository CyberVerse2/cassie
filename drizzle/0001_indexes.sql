CREATE INDEX IF NOT EXISTS "mentions_user_created_idx"
  ON "mentions" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "runs_mention_idx"
  ON "runs" ("mention_id");

CREATE INDEX IF NOT EXISTS "runs_user_created_idx"
  ON "runs" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "research_reports_run_idx"
  ON "research_reports" ("run_id");

CREATE INDEX IF NOT EXISTS "trade_tickets_user_state_idx"
  ON "trade_tickets" ("user_id", "approval_state");

CREATE INDEX IF NOT EXISTS "execution_jobs_status_updated_idx"
  ON "execution_jobs" ("status", "updated_at");

CREATE INDEX IF NOT EXISTS "execution_jobs_ticket_idx"
  ON "execution_jobs" ("ticket_id");

CREATE INDEX IF NOT EXISTS "audit_events_entity_idx"
  ON "audit_events" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "audit_events_created_idx"
  ON "audit_events" ("created_at");
