import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ControlRun,
  CustodyBalance,
  CustodyLedgerEntry,
  ExecutionJob,
  RunStep,
  SourcePost,
  TradeTicket,
  UserSettings,
} from "../schemas/index.ts";
import {
  auditEvents,
  controlRuns,
  custodyBalances,
  custodyLedgerEntries,
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
      custodyBalanceRows,
      custodyLedgerRows,
      controlRunRows,
      stepRows,
      modelCallUsageRows,
    ] = await Promise.all([
      this.db.select().from(userSettings),
      this.db.select().from(mentions),
      this.db.select().from(tradeTickets),
      this.db.select().from(executionJobs),
      this.db.select().from(auditEvents),
      this.db.select().from(custodyBalances),
      this.db.select().from(custodyLedgerEntries),
      this.db.select().from(controlRuns),
      this.db.select().from(runSteps),
      this.db.select().from(modelCallUsage),
    ]);

    return {
      userSettings: userSettingsRows.map((row) => row.settings),
      mentions: mentionRows,
      tradeTickets: ticketRows.map((row) => row.ticket),
      executionJobs: jobRows.map((row) => row.job),
      custodyBalances: custodyBalanceRows,
      custodyLedgerEntries: custodyLedgerRows.map((row) => ({
        ...row,
        ticketId: row.ticketId ?? null,
        executionJobId: row.executionJobId ?? null,
        source: row.source ?? null,
        externalRef: row.externalRef ?? null,
        metadata: row.metadata ?? null,
      })),
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

  async creditUserBalance(input: {
    userId: string;
    amountUsd: number;
    source: string;
    externalRef?: string | null;
    metadata?: unknown;
  }): Promise<CustodyBalance> {
    assertPositiveAmount(input.amountUsd);
    return await this.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const balanceRows = await tx
        .insert(custodyBalances)
        .values({
          userId: input.userId,
          availableUsd: input.amountUsd,
          reservedUsd: 0,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: custodyBalances.userId,
          set: {
            availableUsd: sql`${custodyBalances.availableUsd} + ${input.amountUsd}`,
            updatedAt: now,
          },
        })
        .returning();

      const balance = balanceRows[0];
      if (!balance) {
        throw new Error(`Unable to credit swept balance for user ${input.userId}.`);
      }

      await tx.insert(custodyLedgerEntries).values({
        entryId: randomUUID(),
        userId: input.userId,
        type: "sweep_credit",
        amountUsd: input.amountUsd,
        ticketId: null,
        executionJobId: null,
        source: input.source,
        externalRef: input.externalRef ?? null,
        metadata: input.metadata ?? null,
        createdAt: now,
      });
      return balance;
    });
  }

  async getCustodyBalance(userId: string): Promise<CustodyBalance | undefined> {
    const rows = await this.db
      .select()
      .from(custodyBalances)
      .where(eq(custodyBalances.userId, userId))
      .limit(1);

    return rows[0];
  }

  async reserveTradeFunds(ticket: TradeTicket, job: ExecutionJob): Promise<CustodyBalance> {
    assertPositiveAmount(ticket.sizeUsd);
    return await this.db.transaction(async (tx) => {
      const existingReserve = await tx
        .select()
        .from(custodyLedgerEntries)
        .where(and(
          eq(custodyLedgerEntries.type, "trade_reserve"),
          eq(custodyLedgerEntries.executionJobId, job.jobId),
        ))
        .limit(1);
      if (existingReserve[0]) {
        const existingBalance = await tx
          .select()
          .from(custodyBalances)
          .where(eq(custodyBalances.userId, ticket.userId))
          .limit(1);
        if (!existingBalance[0]) throw new Error(`No swept balance found for user ${ticket.userId}.`);
        return existingBalance[0];
      }

      const now = new Date().toISOString();
      const balanceRows = await tx
        .update(custodyBalances)
        .set({
          availableUsd: sql`${custodyBalances.availableUsd} - ${ticket.sizeUsd}`,
          reservedUsd: sql`${custodyBalances.reservedUsd} + ${ticket.sizeUsd}`,
          updatedAt: now,
        })
        .where(and(
          eq(custodyBalances.userId, ticket.userId),
          gte(custodyBalances.availableUsd, ticket.sizeUsd),
        ))
        .returning();
      const balance = balanceRows[0];
      if (!balance) {
        throw new Error("Insufficient swept balance.");
      }

      await tx.insert(custodyLedgerEntries).values(tradeLedgerEntry({
        userId: ticket.userId,
        type: "trade_reserve",
        amountUsd: ticket.sizeUsd,
        ticketId: ticket.ticketId,
        executionJobId: job.jobId,
        metadata: { venue: ticket.venue, instrument: ticket.instrument, side: ticket.side },
        createdAt: now,
      }));
      return balance;
    });
  }

  async releaseTradeReservation(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    reason: string;
  }): Promise<CustodyBalance> {
    return await this.db.transaction(async (tx) => {
      const existingRelease = await tx
        .select()
        .from(custodyLedgerEntries)
        .where(and(
          eq(custodyLedgerEntries.type, "trade_release"),
          eq(custodyLedgerEntries.executionJobId, input.job.jobId),
        ))
        .limit(1);
      if (existingRelease[0]) {
        const existingBalance = await tx
          .select()
          .from(custodyBalances)
          .where(eq(custodyBalances.userId, input.ticket.userId))
          .limit(1);
        if (!existingBalance[0]) throw new Error(`No swept balance found for user ${input.ticket.userId}.`);
        return existingBalance[0];
      }

      const now = new Date().toISOString();
      const balanceRows = await tx
        .update(custodyBalances)
        .set({
          availableUsd: sql`${custodyBalances.availableUsd} + ${input.ticket.sizeUsd}`,
          reservedUsd: sql`${custodyBalances.reservedUsd} - ${input.ticket.sizeUsd}`,
          updatedAt: now,
        })
        .where(and(
          eq(custodyBalances.userId, input.ticket.userId),
          gte(custodyBalances.reservedUsd, input.ticket.sizeUsd),
        ))
        .returning();
      const balance = balanceRows[0];
      if (!balance) {
        throw new Error("Cannot release a missing trade reservation.");
      }

      await tx.insert(custodyLedgerEntries).values(tradeLedgerEntry({
        userId: input.ticket.userId,
        type: "trade_release",
        amountUsd: input.ticket.sizeUsd,
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        metadata: { reason: input.reason },
        createdAt: now,
      }));
      return balance;
    });
  }

  async settleTradeReservation(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    executionResult: NonNullable<ExecutionJob["executionResult"]>;
  }): Promise<CustodyBalance> {
    return await this.db.transaction(async (tx) => {
      const existingSettlement = await tx
        .select()
        .from(custodyLedgerEntries)
        .where(and(
          eq(custodyLedgerEntries.type, "trade_settlement"),
          eq(custodyLedgerEntries.executionJobId, input.job.jobId),
        ))
        .limit(1);
      if (existingSettlement[0]) {
        const existingBalance = await tx
          .select()
          .from(custodyBalances)
          .where(eq(custodyBalances.userId, input.ticket.userId))
          .limit(1);
        if (!existingBalance[0]) throw new Error(`No swept balance found for user ${input.ticket.userId}.`);
        return existingBalance[0];
      }

      const filledSizeUsd = normalizedFilledSize(input.ticket, input.executionResult);
      const releaseUsd = input.ticket.sizeUsd - filledSizeUsd;
      const now = new Date().toISOString();
      const balanceRows = await tx
        .update(custodyBalances)
        .set({
          availableUsd: sql`${custodyBalances.availableUsd} + ${releaseUsd}`,
          reservedUsd: sql`${custodyBalances.reservedUsd} - ${input.ticket.sizeUsd}`,
          updatedAt: now,
        })
        .where(and(
          eq(custodyBalances.userId, input.ticket.userId),
          gte(custodyBalances.reservedUsd, input.ticket.sizeUsd),
        ))
        .returning();
      const balance = balanceRows[0];
      if (!balance) {
        throw new Error("Cannot settle a missing trade reservation.");
      }

      await tx.insert(custodyLedgerEntries).values(tradeLedgerEntry({
        userId: input.ticket.userId,
        type: "trade_settlement",
        amountUsd: filledSizeUsd,
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        metadata: input.executionResult,
        createdAt: now,
      }));

      if (releaseUsd > 0) {
        await tx.insert(custodyLedgerEntries).values(tradeLedgerEntry({
          userId: input.ticket.userId,
          type: "trade_release",
          amountUsd: releaseUsd,
          ticketId: input.ticket.ticketId,
          executionJobId: input.job.jobId,
          metadata: { reason: "unfilled_order_amount" },
          createdAt: now,
        }));
      }
      return balance;
    });
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

function assertPositiveAmount(amountUsd: number): void {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Custody amount must be a positive USD value.");
  }
}

function normalizedFilledSize(
  ticket: TradeTicket,
  executionResult: NonNullable<ExecutionJob["executionResult"]>,
): number {
  const filledSizeUsd = executionResult.filledSizeUsd;
  if (!Number.isFinite(filledSizeUsd) || filledSizeUsd < 0) {
    throw new Error("Execution result filledSizeUsd must be nonnegative.");
  }
  if (filledSizeUsd > ticket.sizeUsd) {
    throw new Error("Execution result filled more than the reserved ticket size.");
  }
  return filledSizeUsd;
}

function tradeLedgerEntry(input: Omit<CustodyLedgerEntry, "entryId" | "source" | "externalRef">): CustodyLedgerEntry {
  return {
    ...input,
    entryId: randomUUID(),
    source: null,
    externalRef: null,
  };
}
