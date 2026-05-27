import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ControlRun,
  ExecutionJob,
  RunStep,
  SourcePost,
  TradeTicket,
  UserSettings,
} from "../schemas/index.ts";
import {
  auditEvents,
  controlRuns,
  executionJobs,
  mentions,
  runtimeState,
  runSteps,
  tradeTickets,
  modelCallUsage,
  userSettings,
} from "./schema.ts";
import { createCassieDb, type CassieDb } from "./client.ts";
import type {
  CassieStore,
  CassieStoreSnapshot,
  MentionRecord,
  NewModelCallUsage,
  NewRunStep,
} from "./store.ts";

export class DrizzleCassieStore implements CassieStore {
  constructor(private readonly db: CassieDb = createCassieDb()) {}

  async load(): Promise<CassieStoreSnapshot> {
    const [
      userSettingsRows,
      mentionRows,
      ticketRows,
      jobRows,
      auditRows,
      controlRunRows,
      stepRows,
      modelCallUsageRows,
    ] = await Promise.all([
      this.db.select().from(userSettings),
      this.db.select().from(mentions),
      this.db.select().from(tradeTickets),
      this.db.select().from(executionJobs),
      this.db.select().from(auditEvents),
      this.db.select().from(controlRuns),
      this.db.select().from(runSteps),
      this.db.select().from(modelCallUsage),
    ]);

    return {
      userSettings: userSettingsRows.map((row) => row.settings),
      mentions: mentionRows,
      tradeTickets: ticketRows.map((row) => row.ticket),
      executionJobs: jobRows.map((row) => row.job),
      auditEvents: auditRows.map((row) => ({
        ...row,
        data: row.data ?? undefined,
      })),
      controlRuns: controlRunRows.map((row) => ({
        ...row,
        result: row.result ?? null,
      })),
      runSteps: stepRows.map((row) => ({
        ...row,
        input: row.input ?? null,
        output: row.output ?? null,
        thinkingTrace: row.thinkingTrace ?? null,
      })),
      modelCallUsage: modelCallUsageRows.map((row) => ({
        ...row,
        runStepId: row.runStepId ?? null,
        promptName: row.promptName ?? null,
        promptVersion: row.promptVersion ?? null,
        inputTokens: row.inputTokens ?? null,
        outputTokens: row.outputTokens ?? null,
        reasoningTokens: row.reasoningTokens ?? null,
        cachedTokens: row.cachedTokens ?? null,
        totalTokens: row.totalTokens ?? null,
        estimatedCostUsd: row.estimatedCostUsd ?? null,
        latencyMs: row.latencyMs ?? null,
        thinkingTrace: row.thinkingTrace ?? null,
        error: row.error ?? null,
      })),
    };
  }

  async upsertUserSettings(settings: UserSettings): Promise<void> {
    await this.db
      .insert(userSettings)
      .values({
        userId: settings.userId,
        settings,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          settings,
          updatedAt: new Date().toISOString(),
        },
      });
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const rows = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    return rows[0]?.settings;
  }

  async createRun(input: {
    userId: string;
    userCommand: string;
    sourcePost: SourcePost;
  }): Promise<ControlRun> {
    const now = new Date().toISOString();
    const run: ControlRun = {
      ...input,
      runId: randomUUID(),
      status: "queued",
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(controlRuns).values(run);
    return run;
  }

  async updateRun(run: ControlRun): Promise<ControlRun> {
    await this.db
      .update(controlRuns)
      .set({
        userCommand: run.userCommand,
        sourcePost: run.sourcePost,
        status: run.status,
        result: run.result,
        error: run.error,
        updatedAt: run.updatedAt,
      })
      .where(eq(controlRuns.runId, run.runId));

    return run;
  }

  async getRun(runId: string): Promise<ControlRun | undefined> {
    const rows = await this.db
      .select()
      .from(controlRuns)
      .where(eq(controlRuns.runId, runId))
      .limit(1);

    const row = rows[0];
    return row ? { ...row, result: row.result ?? null } : undefined;
  }

  async addRunStep(input: NewRunStep): Promise<RunStep> {
    const step: RunStep = {
      ...input,
      stepId: randomUUID(),
      thinkingTrace: input.thinkingTrace ?? null,
      startedAt: new Date().toISOString(),
      completedAt: input.completedAt ?? null,
    };
    await this.db.insert(runSteps).values(step);
    return step;
  }

  async updateRunStep(step: RunStep): Promise<RunStep> {
    await this.db
      .update(runSteps)
      .set({
        stepType: step.stepType,
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error,
        model: step.model,
        promptName: step.promptName,
        promptVersion: step.promptVersion,
        thinkingTrace: step.thinkingTrace ?? null,
        completedAt: step.completedAt,
      })
      .where(eq(runSteps.stepId, step.stepId));

    return step;
  }

  async getRunSteps(runId: string): Promise<RunStep[]> {
    const rows = await this.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId));

    return rows.map((row) => ({
      ...row,
      input: row.input ?? null,
      output: row.output ?? null,
      thinkingTrace: row.thinkingTrace ?? null,
    }));
  }

  async addMention(input: Omit<MentionRecord, "mentionId" | "createdAt">): Promise<MentionRecord> {
    const mention: MentionRecord = {
      ...input,
      mentionId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(mentions).values(mention);
    await this.audit({
      entityId: mention.mentionId,
      entityType: "mention",
      eventType: "mention.received",
      message: "Cassie mention received.",
      data: mention,
    });

    return mention;
  }

  async addModelCallUsage(input: NewModelCallUsage) {
    const record = {
      ...input,
      id: randomUUID(),
      thinkingTrace: input.thinkingTrace ?? null,
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(modelCallUsage).values(record);
    return record;
  }

  async addTradeTicket(ticket: TradeTicket): Promise<TradeTicket> {
    const now = new Date().toISOString();
    await this.db.insert(tradeTickets).values({
      ticketId: ticket.ticketId,
      runId: ticket.runId ?? null,
      userId: ticket.userId,
      ticket,
      createdAt: now,
      updatedAt: now,
    });
    await this.audit({
      entityId: ticket.ticketId,
      entityType: "trade_ticket",
      eventType: "trade_ticket.created",
      message: "Trade ticket created.",
      data: ticket,
    });

    return ticket;
  }

  async updateTradeTicket(ticket: TradeTicket): Promise<TradeTicket> {
    await this.db
      .update(tradeTickets)
      .set({
        runId: ticket.runId ?? null,
        ticket,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tradeTickets.ticketId, ticket.ticketId));

    return ticket;
  }

  async getTradeTicket(ticketId: string): Promise<TradeTicket | undefined> {
    const rows = await this.db
      .select()
      .from(tradeTickets)
      .where(eq(tradeTickets.ticketId, ticketId))
      .limit(1);

    return rows[0]?.ticket;
  }

  async addExecutionJob(job: ExecutionJob): Promise<ExecutionJob> {
    await this.db.insert(executionJobs).values({
      jobId: job.jobId,
      ticketId: job.ticketId,
      job,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
    await this.audit({
      entityId: job.jobId,
      entityType: "execution_job",
      eventType: "execution_job.created",
      message: "Execution job created.",
      data: job,
    });

    return job;
  }

  async updateExecutionJob(job: ExecutionJob): Promise<ExecutionJob> {
    await this.db
      .update(executionJobs)
      .set({
        job,
        status: job.status,
        updatedAt: job.updatedAt,
      })
      .where(eq(executionJobs.jobId, job.jobId));

    return job;
  }

  async getExecutionJob(jobId: string): Promise<ExecutionJob | undefined> {
    const rows = await this.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.jobId, jobId))
      .limit(1);

    return rows[0]?.job;
  }

  async listTradeTicketsWithoutExecutionJob(runId: string): Promise<TradeTicket[]> {
    const ticketRows = await this.db
      .select()
      .from(tradeTickets)
      .where(eq(tradeTickets.runId, runId));
    const tickets = ticketRows.map((row) => row.ticket);
    const ticketIds = tickets.map((ticket) => ticket.ticketId);

    if (ticketIds.length === 0) {
      return [];
    }

    const jobRows = await this.db
      .select({ ticketId: executionJobs.ticketId })
      .from(executionJobs)
      .where(inArray(executionJobs.ticketId, ticketIds));
    const existingExecutionTicketIds = new Set(jobRows.map((row) => row.ticketId));

    return tickets.filter((ticket) => !existingExecutionTicketIds.has(ticket.ticketId));
  }

  async getNextQueuedExecutionJob(): Promise<ExecutionJob | undefined> {
    const rows = await this.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.status, "queued"))
      .limit(1);

    return rows[0]?.job;
  }

  async getRuntimeState<T = unknown>(key: string): Promise<T | undefined> {
    const rows = await this.db
      .select()
      .from(runtimeState)
      .where(eq(runtimeState.key, key))
      .limit(1);

    return rows[0]?.value as T | undefined;
  }

  async setRuntimeState(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(runtimeState)
      .values({
        key,
        value,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: runtimeState.key,
        set: {
          value,
          updatedAt: new Date().toISOString(),
        },
      });
  }

  async audit(input: Omit<AuditEvent, "eventId" | "createdAt">): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      eventId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(auditEvents).values(event);
    return event;
  }
}
