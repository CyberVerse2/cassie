import { index, integer, jsonb, pgTable, real, text } from "drizzle-orm/pg-core";
import type {
  AuditEvent,
  ControlRun,
  ExecutionJob,
  RunStep,
  SourcePost,
  TradeTicket,
  UserSettings,
  WalletSpendLedgerEntry,
} from "../schemas/index.ts";
import type {
  ModelCallUsageRecord,
} from "./store.ts";

export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  privyUserId: text("privy_user_id"),
  privyWalletId: text("privy_wallet_id"),
  walletAddress: text("wallet_address"),
  settings: jsonb("settings").$type<UserSettings>().notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("user_settings_privy_user_idx").on(table.privyUserId),
  index("user_settings_privy_wallet_idx").on(table.privyWalletId),
]);

export const mentions = pgTable("mentions", {
  mentionId: text("mention_id").primaryKey(),
  userId: text("user_id").notNull(),
  userCommand: text("user_command").notNull(),
  sourcePost: jsonb("source_post").$type<SourcePost>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("mentions_user_created_idx").on(table.userId, table.createdAt),
]);

export const tradeTickets = pgTable("trade_tickets", {
  ticketId: text("ticket_id").primaryKey(),
  runId: text("run_id"),
  userId: text("user_id").notNull(),
  ticket: jsonb("ticket").$type<TradeTicket>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("trade_tickets_run_idx").on(table.runId),
  index("trade_tickets_user_idx").on(table.userId),
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

export const walletSpendLedgerEntries = pgTable("wallet_spend_ledger_entries", {
  entryId: text("entry_id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").$type<WalletSpendLedgerEntry["type"]>().notNull(),
  amountUsd: real("amount_usd").notNull(),
  ticketId: text("ticket_id"),
  executionJobId: text("execution_job_id"),
  metadata: jsonb("metadata"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("wallet_spend_ledger_user_created_idx").on(table.userId, table.createdAt),
  index("wallet_spend_ledger_ticket_idx").on(table.ticketId),
  index("wallet_spend_ledger_execution_job_idx").on(table.executionJobId),
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
  thinkingTrace: text("thinking_trace"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  index("run_steps_run_started_idx").on(table.runId, table.startedAt),
  index("run_steps_status_idx").on(table.status),
]);

export const modelCallUsage = pgTable("model_call_usage", {
  id: text("id").primaryKey(),
  controlRunId: text("control_run_id").notNull(),
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
  thinkingTrace: text("thinking_trace"),
  status: text("status").$type<ModelCallUsageRecord["status"]>().notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("model_call_usage_control_idx").on(table.controlRunId, table.createdAt),
  index("model_call_usage_model_idx").on(table.model),
]);
