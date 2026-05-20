import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ExecutionJob,
  ResearchReport,
  SourcePost,
  StoredRun,
  TradeTicket,
  UserSettings,
} from "../schemas.ts";
import {
  auditEvents,
  executionJobs,
  mentions,
  researchReports,
  runtimeState,
  runs,
  tradeTickets,
  userSettings,
} from "./schema.ts";
import { createCassieDb, type CassieDb } from "./client.ts";
import type {
  CassieStore,
  CassieStoreSnapshot,
  MentionRecord,
  ResearchReportRecord,
} from "../store.ts";

export class DrizzleCassieStore implements CassieStore {
  constructor(private readonly db: CassieDb = createCassieDb()) {}

  async load(): Promise<CassieStoreSnapshot> {
    const [
      userSettingsRows,
      mentionRows,
      runRows,
      reportRows,
      ticketRows,
      jobRows,
      auditRows,
    ] = await Promise.all([
      this.db.select().from(userSettings),
      this.db.select().from(mentions),
      this.db.select().from(runs),
      this.db.select().from(researchReports),
      this.db.select().from(tradeTickets),
      this.db.select().from(executionJobs),
      this.db.select().from(auditEvents),
    ]);

    return {
      userSettings: userSettingsRows.map((row) => row.settings),
      mentions: mentionRows,
      runs: runRows.map((row) => ({
        ...row,
        result: row.result,
      })),
      researchReports: reportRows,
      tradeTickets: ticketRows.map((row) => row.ticket),
      executionJobs: jobRows.map((row) => row.job),
      auditEvents: auditRows.map((row) => ({
        ...row,
        data: row.data ?? undefined,
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

  async addRun(run: Omit<StoredRun, "runId" | "createdAt">): Promise<StoredRun> {
    const storedRun: StoredRun = {
      ...run,
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(runs).values(storedRun);
    await this.audit({
      entityId: storedRun.runId,
      entityType: "run",
      eventType: "run.completed",
      message: "Cassie run completed.",
      data: { responseType: storedRun.responseType, mentionId: storedRun.mentionId },
    });

    return storedRun;
  }

  async addResearchReport(input: {
    runId: string;
    report: ResearchReport;
  }): Promise<ResearchReportRecord> {
    const record: ResearchReportRecord = {
      reportId: randomUUID(),
      runId: input.runId,
      report: input.report,
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(researchReports).values(record);
    await this.audit({
      entityId: record.reportId,
      entityType: "research_report",
      eventType: "research_report.saved",
      message: "Research report saved.",
      data: { runId: input.runId, stance: input.report.stance },
    });

    return record;
  }

  async addTradeTicket(ticket: TradeTicket): Promise<TradeTicket> {
    const now = new Date().toISOString();
    await this.db.insert(tradeTickets).values({
      ticketId: ticket.ticketId,
      userId: ticket.userId,
      ticket,
      approvalState: ticket.approvalState,
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
        ticket,
        approvalState: ticket.approvalState,
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
