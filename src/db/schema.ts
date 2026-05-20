import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import type {
  AuditEvent,
  ExecutionJob,
  ResearchReport,
  SourcePost,
  StoredRun,
  TradeTicket,
  UserSettings,
} from "../schemas.ts";

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

export const runs = pgTable("runs", {
  runId: text("run_id").primaryKey(),
  mentionId: text("mention_id").notNull(),
  userId: text("user_id").notNull(),
  userCommand: text("user_command").notNull(),
  sourcePost: jsonb("source_post").$type<SourcePost>().notNull(),
  responseType: text("response_type").$type<StoredRun["responseType"]>().notNull(),
  result: jsonb("result").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("runs_mention_idx").on(table.mentionId),
  index("runs_user_created_idx").on(table.userId, table.createdAt),
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
  userId: text("user_id").notNull(),
  ticket: jsonb("ticket").$type<TradeTicket>().notNull(),
  approvalState: text("approval_state").$type<TradeTicket["approvalState"]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
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
