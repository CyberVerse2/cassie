DROP TABLE IF EXISTS "research_continuation_decisions";
DROP TABLE IF EXISTS "research_goal_resolutions";
DROP TABLE IF EXISTS "research_goal_evidence_links";
DROP TABLE IF EXISTS "research_evidence_claims";
DROP TABLE IF EXISTS "research_search_results";
DROP TABLE IF EXISTS "research_query_jobs";
DROP TABLE IF EXISTS "research_runs";
DROP TABLE IF EXISTS "research_reports";
DROP TABLE IF EXISTS "tradeability_decisions";

DROP INDEX IF EXISTS "model_call_usage_research_idx";
ALTER TABLE "model_call_usage" DROP COLUMN IF EXISTS "research_run_id";
