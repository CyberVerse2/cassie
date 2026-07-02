import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, real, text, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  AuditEvent,
  ControlRun,
  ExecutionJob,
  PortfolioBalanceSnapshot,
  Position,
  PositionReview,
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

export const positions = pgTable("positions", {
  positionId: text("position_id").primaryKey(),
  userId: text("user_id").notNull(),
  ticketId: text("ticket_id").notNull(),
  executionJobId: text("execution_job_id").notNull(),
  status: text("status").$type<Position["status"]>().notNull(),
  position: jsonb("position").$type<Position>().notNull(),
  openedAt: text("opened_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("positions_user_status_opened_idx").on(table.userId, table.status, table.openedAt),
  index("positions_ticket_idx").on(table.ticketId),
  uniqueIndex("positions_execution_job_unique_idx").on(table.executionJobId),
  foreignKey({
    name: "positions_user_fk",
    columns: [table.userId],
    foreignColumns: [userSettings.userId],
  }).onDelete("cascade"),
  foreignKey({
    name: "positions_ticket_fk",
    columns: [table.ticketId],
    foreignColumns: [tradeTickets.ticketId],
  }).onDelete("cascade"),
  foreignKey({
    name: "positions_execution_job_fk",
    columns: [table.executionJobId],
    foreignColumns: [executionJobs.jobId],
  }).onDelete("cascade"),
]);

export const positionReviews = pgTable("position_reviews", {
  reviewId: text("review_id").primaryKey(),
  positionId: text("position_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").$type<PositionReview["status"]>().notNull(),
  review: jsonb("review").$type<PositionReview>().notNull(),
  reviewedAt: text("reviewed_at").notNull(),
}, (table) => [
  index("position_reviews_position_reviewed_idx").on(table.positionId, table.reviewedAt),
  index("position_reviews_user_reviewed_idx").on(table.userId, table.reviewedAt),
  foreignKey({
    name: "position_reviews_position_fk",
    columns: [table.positionId],
    foreignColumns: [positions.positionId],
  }).onDelete("cascade"),
  foreignKey({
    name: "position_reviews_user_fk",
    columns: [table.userId],
    foreignColumns: [userSettings.userId],
  }).onDelete("cascade"),
]);

export const portfolioBalanceSnapshots = pgTable("portfolio_balance_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  userId: text("user_id").notNull(),
  snapshot: jsonb("snapshot").$type<PortfolioBalanceSnapshot>().notNull(),
  at: text("at").notNull(),
}, (table) => [
  index("portfolio_balance_snapshots_user_at_idx").on(table.userId, table.at),
  foreignKey({
    name: "portfolio_balance_snapshots_user_fk",
    columns: [table.userId],
    foreignColumns: [userSettings.userId],
  }).onDelete("cascade"),
]);

export const userDepositAddresses = pgTable("user_deposit_addresses", {
  userId: text("user_id").primaryKey(),
  walletSetId: text("wallet_set_id").notNull(),
  circleWalletId: text("circle_wallet_id").notNull(),
  evmAddress: text("evm_address").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("user_deposit_addresses_evm_address_unique_idx").on(table.evmAddress),
  foreignKey({
    name: "user_deposit_addresses_user_fk",
    columns: [table.userId],
    foreignColumns: [userSettings.userId],
  }).onDelete("cascade"),
]);

export const walletSpendLedgerEntries = pgTable("wallet_spend_ledger_entries", {
  entryId: text("entry_id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").$type<WalletSpendLedgerEntry["type"]>().notNull(),
  amountUsdCents: integer("amount_usd_cents").notNull(),
  ticketId: text("ticket_id"),
  executionJobId: text("execution_job_id"),
  chain: text("chain"),
  txHash: text("tx_hash"),
  logIndex: integer("log_index"),
  circleTransferId: text("circle_transfer_id"),
  metadata: jsonb("metadata"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("wallet_spend_ledger_user_created_idx").on(table.userId, table.createdAt),
  index("wallet_spend_ledger_ticket_idx").on(table.ticketId),
  index("wallet_spend_ledger_execution_job_idx").on(table.executionJobId),
  uniqueIndex("wallet_spend_ledger_execution_type_unique_idx")
    .on(table.executionJobId, table.type)
    .where(sql`${table.executionJobId} is not null`),
  uniqueIndex("wallet_spend_ledger_circle_transfer_unique_idx")
    .on(table.circleTransferId, table.type)
    .where(sql`${table.circleTransferId} is not null`),
  uniqueIndex("wallet_spend_ledger_deposit_tx_unique_idx")
    .on(table.chain, table.txHash, table.logIndex)
    .where(sql`${table.txHash} is not null`),
  check("wallet_spend_ledger_amount_cents_nonnegative", sql`${table.amountUsdCents} >= 0`),
  foreignKey({
    name: "wallet_spend_ledger_user_fk",
    columns: [table.userId],
    foreignColumns: [userSettings.userId],
  }).onDelete("cascade"),
  foreignKey({
    name: "wallet_spend_ledger_ticket_fk",
    columns: [table.ticketId],
    foreignColumns: [tradeTickets.ticketId],
  }).onDelete("cascade"),
  foreignKey({
    name: "wallet_spend_ledger_execution_job_fk",
    columns: [table.executionJobId],
    foreignColumns: [executionJobs.jobId],
  }).onDelete("cascade"),
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
