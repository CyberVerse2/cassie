ALTER TABLE "run_steps"
  ADD COLUMN IF NOT EXISTS "thinking_trace" text;

ALTER TABLE "model_call_usage"
  ADD COLUMN IF NOT EXISTS "thinking_trace" text;
