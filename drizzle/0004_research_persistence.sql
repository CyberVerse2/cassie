CREATE TABLE IF NOT EXISTS "research_runs" (
  "research_run_id" text PRIMARY KEY NOT NULL,
  "control_run_id" text NOT NULL,
  "angle" text NOT NULL,
  "status" text NOT NULL,
  "query_plan" jsonb,
  "started_at" text NOT NULL,
  "completed_at" text,
  "error" text
);

CREATE INDEX IF NOT EXISTS "research_runs_control_idx"
  ON "research_runs" ("control_run_id", "started_at");

CREATE INDEX IF NOT EXISTS "research_runs_status_idx"
  ON "research_runs" ("status");

CREATE TABLE IF NOT EXISTS "research_query_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "research_run_id" text NOT NULL,
  "job" jsonb NOT NULL,
  "wave" integer NOT NULL,
  "lane" text NOT NULL,
  "provider" text NOT NULL,
  "query_spec_id" text NOT NULL,
  "status" text NOT NULL,
  "started_at" text,
  "completed_at" text,
  "error" text
);

CREATE INDEX IF NOT EXISTS "research_query_jobs_run_wave_idx"
  ON "research_query_jobs" ("research_run_id", "wave");

CREATE INDEX IF NOT EXISTS "research_query_jobs_status_idx"
  ON "research_query_jobs" ("status");

CREATE TABLE IF NOT EXISTS "research_search_results" (
  "id" text PRIMARY KEY NOT NULL,
  "research_run_id" text NOT NULL,
  "query_job_id" text NOT NULL,
  "query_id" text NOT NULL,
  "wave" integer NOT NULL,
  "lane" text NOT NULL,
  "provider" text NOT NULL,
  "source_type" text NOT NULL,
  "url" text,
  "result" jsonb NOT NULL,
  "retrieved_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "research_search_results_run_query_idx"
  ON "research_search_results" ("research_run_id", "query_job_id");

CREATE INDEX IF NOT EXISTS "research_search_results_source_type_idx"
  ON "research_search_results" ("source_type");

CREATE TABLE IF NOT EXISTS "research_evidence_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "research_run_id" text NOT NULL,
  "result_id" text NOT NULL,
  "query_job_id" text NOT NULL,
  "wave" integer NOT NULL,
  "source_type" text NOT NULL,
  "directness" text NOT NULL,
  "reliability" text NOT NULL,
  "claim" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "research_evidence_claims_run_query_idx"
  ON "research_evidence_claims" ("research_run_id", "query_job_id");

CREATE INDEX IF NOT EXISTS "research_evidence_claims_reliability_idx"
  ON "research_evidence_claims" ("reliability");

CREATE TABLE IF NOT EXISTS "research_goal_evidence_links" (
  "id" text PRIMARY KEY NOT NULL,
  "research_run_id" text NOT NULL,
  "goal_id" text NOT NULL,
  "evidence_claim_id" text NOT NULL,
  "stance" text NOT NULL,
  "link" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "research_goal_evidence_links_goal_idx"
  ON "research_goal_evidence_links" ("research_run_id", "goal_id");

CREATE INDEX IF NOT EXISTS "research_goal_evidence_links_stance_idx"
  ON "research_goal_evidence_links" ("stance");

CREATE TABLE IF NOT EXISTS "research_goal_resolutions" (
  "id" text PRIMARY KEY NOT NULL,
  "research_run_id" text NOT NULL,
  "wave" integer NOT NULL,
  "goal_id" text NOT NULL,
  "status" text NOT NULL,
  "confidence" real NOT NULL,
  "resolution" jsonb NOT NULL,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "research_goal_resolutions_run_goal_idx"
  ON "research_goal_resolutions" ("research_run_id", "goal_id");

CREATE INDEX IF NOT EXISTS "research_goal_resolutions_status_idx"
  ON "research_goal_resolutions" ("status");

CREATE TABLE IF NOT EXISTS "research_continuation_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "research_run_id" text NOT NULL,
  "wave" integer NOT NULL,
  "action" text NOT NULL,
  "decision" jsonb NOT NULL,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "research_continuation_decisions_run_wave_idx"
  ON "research_continuation_decisions" ("research_run_id", "wave");

CREATE INDEX IF NOT EXISTS "research_continuation_decisions_action_idx"
  ON "research_continuation_decisions" ("action");

CREATE TABLE IF NOT EXISTS "model_call_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "control_run_id" text NOT NULL,
  "research_run_id" text,
  "run_step_id" text,
  "purpose" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_name" text,
  "prompt_version" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "reasoning_tokens" integer,
  "cached_tokens" integer,
  "total_tokens" integer,
  "estimated_cost_usd" real,
  "latency_ms" integer,
  "status" text NOT NULL,
  "error" text,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "model_call_usage_control_idx"
  ON "model_call_usage" ("control_run_id", "created_at");

CREATE INDEX IF NOT EXISTS "model_call_usage_research_idx"
  ON "model_call_usage" ("research_run_id", "created_at");

CREATE INDEX IF NOT EXISTS "model_call_usage_model_idx"
  ON "model_call_usage" ("model");

CREATE TABLE IF NOT EXISTS "tradeability_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "control_run_id" text NOT NULL,
  "research_run_id" text,
  "decision" text NOT NULL,
  "direct_tradability" text NOT NULL,
  "record" jsonb NOT NULL,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "tradeability_decisions_control_idx"
  ON "tradeability_decisions" ("control_run_id", "created_at");

CREATE INDEX IF NOT EXISTS "tradeability_decisions_decision_idx"
  ON "tradeability_decisions" ("decision");
