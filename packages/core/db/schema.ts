import { index, integer, jsonb, pgTable, real, text } from "drizzle-orm/pg-core";
import type {
  AuditEvent,
  ControlRun,
  EvidenceClaim,
  ExecutionJob,
  GoalEvidenceLink,
  GoalResolution,
  QueryJob,
  ResearchContinuationDecision,
  ResearchReport,
  RunStep,
  SearchResult,
  SourcePost,
  TradeTicket,
  UserSettings,
} from "../schemas/index.ts";
import type {
  ModelCallUsageRecord,
  ResearchQueryJobRecord,
  ResearchRunRecord,
  TradeabilityDecisionRecord,
} from "./store.ts";

export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  settings: jsonb("settings").$type<UserSettings>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const mentions = pgTable("mentions", {
  mentionId: text("mention_id").primaryKey(),
  userId: text("user_id").notNull(),
  userCommand: text("user_command").notNull(),
  sourcePost: jsonb("source_post").$type<SourcePost>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("mentions_user_created_idx").on(table.userId, table.createdAt),
]);

export const researchReports = pgTable("research_reports", {
  reportId: text("report_id").primaryKey(),
  runId: text("run_id").notNull(),
  report: jsonb("report").$type<ResearchReport>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("research_reports_run_idx").on(table.runId),
]);

export const tradeTickets = pgTable("trade_tickets", {
  ticketId: text("ticket_id").primaryKey(),
  runId: text("run_id"),
  userId: text("user_id").notNull(),
  ticket: jsonb("ticket").$type<TradeTicket>().notNull(),
  approvalState: text("approval_state").$type<TradeTicket["approvalState"]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("trade_tickets_run_state_idx").on(table.runId, table.approvalState),
  index("trade_tickets_user_state_idx").on(table.userId, table.approvalState),
]);

export const executionJobs = pgTable("execution_jobs", {
  jobId: text("job_id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  job: jsonb("job").$type<ExecutionJob>().notNull(),
  status: text("status").$type<ExecutionJob["status"]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("execution_jobs_status_updated_idx").on(table.status, table.updatedAt),
  index("execution_jobs_ticket_idx").on(table.ticketId),
]);

export const auditEvents = pgTable("audit_events", {
  eventId: text("event_id").primaryKey(),
  entityId: text("entity_id").notNull(),
  entityType: text("entity_type").$type<AuditEvent["entityType"]>().notNull(),
  eventType: text("event_type").notNull(),
  message: text("message").notNull(),
  data: jsonb("data"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("audit_events_entity_idx").on(table.entityType, table.entityId),
  index("audit_events_created_idx").on(table.createdAt),
]);

export const runtimeState = pgTable("runtime_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const controlRuns = pgTable("control_runs", {
  runId: text("run_id").primaryKey(),
  userId: text("user_id").notNull(),
  userCommand: text("user_command").notNull(),
  sourcePost: jsonb("source_post").$type<SourcePost>().notNull(),
  status: text("status").$type<ControlRun["status"]>().notNull(),
  result: jsonb("result"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("control_runs_user_status_idx").on(table.userId, table.status),
  index("control_runs_updated_idx").on(table.updatedAt),
]);

export const runSteps = pgTable("run_steps", {
  stepId: text("step_id").primaryKey(),
  runId: text("run_id").notNull(),
  stepType: text("step_type").$type<RunStep["stepType"]>().notNull(),
  status: text("status").$type<RunStep["status"]>().notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  model: text("model"),
  promptName: text("prompt_name"),
  promptVersion: text("prompt_version"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  index("run_steps_run_started_idx").on(table.runId, table.startedAt),
  index("run_steps_status_idx").on(table.status),
]);

export const researchRuns = pgTable("research_runs", {
  researchRunId: text("research_run_id").primaryKey(),
  controlRunId: text("control_run_id").notNull(),
  angle: text("angle").notNull(),
  status: text("status").$type<ResearchRunRecord["status"]>().notNull(),
  queryPlan: jsonb("query_plan"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  error: text("error"),
}, (table) => [
  index("research_runs_control_idx").on(table.controlRunId, table.startedAt),
  index("research_runs_status_idx").on(table.status),
]);

export const researchQueryJobs = pgTable("research_query_jobs", {
  id: text("id").primaryKey(),
  researchRunId: text("research_run_id").notNull(),
  job: jsonb("job").$type<QueryJob>().notNull(),
  wave: integer("wave").notNull(),
  lane: text("lane").$type<QueryJob["lane"]>().notNull(),
  provider: text("provider").notNull(),
  querySpecId: text("query_spec_id").notNull(),
  status: text("status").$type<ResearchQueryJobRecord["status"]>().notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  error: text("error"),
}, (table) => [
  index("research_query_jobs_run_wave_idx").on(table.researchRunId, table.wave),
  index("research_query_jobs_status_idx").on(table.status),
]);

export const researchSearchResults = pgTable("research_search_results", {
  id: text("id").primaryKey(),
  researchRunId: text("research_run_id").notNull(),
  queryJobId: text("query_job_id").notNull(),
  queryId: text("query_id").notNull(),
  wave: integer("wave").notNull(),
  lane: text("lane").$type<SearchResult["lane"]>().notNull(),
  provider: text("provider").notNull(),
  sourceType: text("source_type").$type<SearchResult["sourceType"]>().notNull(),
  url: text("url"),
  result: jsonb("result").$type<SearchResult>().notNull(),
  retrievedAt: text("retrieved_at").notNull(),
}, (table) => [
  index("research_search_results_run_query_idx").on(table.researchRunId, table.queryJobId),
  index("research_search_results_source_type_idx").on(table.sourceType),
]);

export const researchEvidenceClaims = pgTable("research_evidence_claims", {
  id: text("id").primaryKey(),
  researchRunId: text("research_run_id").notNull(),
  resultId: text("result_id").notNull(),
  queryJobId: text("query_job_id").notNull(),
  wave: integer("wave").notNull(),
  sourceType: text("source_type").$type<EvidenceClaim["sourceType"]>().notNull(),
  directness: text("directness").$type<EvidenceClaim["directness"]>().notNull(),
  reliability: text("reliability").$type<EvidenceClaim["reliability"]>().notNull(),
  claim: jsonb("claim").$type<EvidenceClaim>().notNull(),
}, (table) => [
  index("research_evidence_claims_run_query_idx").on(table.researchRunId, table.queryJobId),
  index("research_evidence_claims_reliability_idx").on(table.reliability),
]);

export const researchGoalEvidenceLinks = pgTable("research_goal_evidence_links", {
  id: text("id").primaryKey(),
  researchRunId: text("research_run_id").notNull(),
  goalId: text("goal_id").notNull(),
  evidenceClaimId: text("evidence_claim_id").notNull(),
  stance: text("stance").$type<GoalEvidenceLink["stance"]>().notNull(),
  link: jsonb("link").$type<GoalEvidenceLink>().notNull(),
}, (table) => [
  index("research_goal_evidence_links_goal_idx").on(table.researchRunId, table.goalId),
  index("research_goal_evidence_links_stance_idx").on(table.stance),
]);

export const researchGoalResolutions = pgTable("research_goal_resolutions", {
  id: text("id").primaryKey(),
  researchRunId: text("research_run_id").notNull(),
  wave: integer("wave").notNull(),
  goalId: text("goal_id").notNull(),
  status: text("status").$type<GoalResolution["status"]>().notNull(),
  confidence: real("confidence").notNull(),
  resolution: jsonb("resolution").$type<GoalResolution>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("research_goal_resolutions_run_goal_idx").on(table.researchRunId, table.goalId),
  index("research_goal_resolutions_status_idx").on(table.status),
]);

export const researchContinuationDecisions = pgTable("research_continuation_decisions", {
  id: text("id").primaryKey(),
  researchRunId: text("research_run_id").notNull(),
  wave: integer("wave").notNull(),
  action: text("action").$type<ResearchContinuationDecision["action"]>().notNull(),
  decision: jsonb("decision").$type<ResearchContinuationDecision>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("research_continuation_decisions_run_wave_idx").on(table.researchRunId, table.wave),
  index("research_continuation_decisions_action_idx").on(table.action),
]);

export const modelCallUsage = pgTable("model_call_usage", {
  id: text("id").primaryKey(),
  controlRunId: text("control_run_id").notNull(),
  researchRunId: text("research_run_id"),
  runStepId: text("run_step_id"),
  purpose: text("purpose").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptName: text("prompt_name"),
  promptVersion: text("prompt_version"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  cachedTokens: integer("cached_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCostUsd: real("estimated_cost_usd"),
  latencyMs: integer("latency_ms"),
  status: text("status").$type<ModelCallUsageRecord["status"]>().notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("model_call_usage_control_idx").on(table.controlRunId, table.createdAt),
  index("model_call_usage_research_idx").on(table.researchRunId, table.createdAt),
  index("model_call_usage_model_idx").on(table.model),
]);

export const tradeabilityDecisions = pgTable("tradeability_decisions", {
  id: text("id").primaryKey(),
  controlRunId: text("control_run_id").notNull(),
  researchRunId: text("research_run_id"),
  decision: text("decision").$type<TradeabilityDecisionRecord["decision"]>().notNull(),
  directTradability: text("direct_tradability").$type<TradeabilityDecisionRecord["directTradability"]>().notNull(),
  record: jsonb("record").$type<TradeabilityDecisionRecord>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("tradeability_decisions_control_idx").on(table.controlRunId, table.createdAt),
  index("tradeability_decisions_decision_idx").on(table.decision),
]);
