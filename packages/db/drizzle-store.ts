import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ControlRun,
  EvidenceLedger,
  ExecutionJob,
  GoalResolution,
  QueryJob,
  ResearchContinuationDecision,
  ResearchReport,
  RunStep,
  SourcePost,
  TradeTicket,
  UserSettings,
} from "../core/schemas/index.ts";
import {
  auditEvents,
  controlRuns,
  executionJobs,
  mentions,
  researchReports,
  researchContinuationDecisions,
  researchEvidenceClaims,
  researchGoalEvidenceLinks,
  researchGoalResolutions,
  researchQueryJobs,
  researchRuns,
  researchSearchResults,
  runtimeState,
  runSteps,
  tradeTickets,
  modelCallUsage,
  tradeabilityDecisions,
  userSettings,
} from "./schema.ts";
import { createCassieDb, type CassieDb } from "./client.ts";
import type {
  CassieStore,
  CassieStoreSnapshot,
  MentionRecord,
  NewModelCallUsage,
  NewRunStep,
  NewTradeabilityDecision,
  ResearchReportRecord,
  ResearchRunRecord,
  ResearchQueryJobRecord,
} from "./store.ts";

export class DrizzleCassieStore implements CassieStore {
  constructor(private readonly db: CassieDb = createCassieDb()) {}

  async load(): Promise<CassieStoreSnapshot> {
    const [
      userSettingsRows,
      mentionRows,
      reportRows,
      ticketRows,
      jobRows,
      auditRows,
      controlRunRows,
      stepRows,
      researchRunRows,
      queryJobRows,
      searchResultRows,
      evidenceClaimRows,
      goalEvidenceLinkRows,
      goalResolutionRows,
      continuationDecisionRows,
      modelCallUsageRows,
      tradeabilityDecisionRows,
    ] = await Promise.all([
      this.db.select().from(userSettings),
      this.db.select().from(mentions),
      this.db.select().from(researchReports),
      this.db.select().from(tradeTickets),
      this.db.select().from(executionJobs),
      this.db.select().from(auditEvents),
      this.db.select().from(controlRuns),
      this.db.select().from(runSteps),
      this.db.select().from(researchRuns),
      this.db.select().from(researchQueryJobs),
      this.db.select().from(researchSearchResults),
      this.db.select().from(researchEvidenceClaims),
      this.db.select().from(researchGoalEvidenceLinks),
      this.db.select().from(researchGoalResolutions),
      this.db.select().from(researchContinuationDecisions),
      this.db.select().from(modelCallUsage),
      this.db.select().from(tradeabilityDecisions),
    ]);

    return {
      userSettings: userSettingsRows.map((row) => row.settings),
      mentions: mentionRows,
      researchReports: reportRows,
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
      })),
      researchRuns: researchRunRows.map((row) => ({
        ...row,
        queryPlan: row.queryPlan ?? null,
        completedAt: row.completedAt ?? null,
        error: row.error ?? null,
      })),
      researchQueryJobs: queryJobRows.map((row) => ({
        ...row.job,
        researchRunId: row.researchRunId,
        status: row.status,
        startedAt: row.startedAt ?? null,
        completedAt: row.completedAt ?? null,
        error: row.error ?? null,
      })),
      researchSearchResults: searchResultRows.map((row) => ({
        ...row.result,
        researchRunId: row.researchRunId,
      })),
      researchEvidenceClaims: evidenceClaimRows.map((row) => ({
        ...row.claim,
        researchRunId: row.researchRunId,
      })),
      researchGoalEvidenceLinks: goalEvidenceLinkRows.map((row) => ({
        ...row.link,
        researchRunId: row.researchRunId,
      })),
      researchGoalResolutions: goalResolutionRows.map((row) => ({
        ...row.resolution,
        id: row.id,
        researchRunId: row.researchRunId,
        wave: row.wave,
        createdAt: row.createdAt,
      })),
      researchContinuationDecisions: continuationDecisionRows.map((row) => ({
        ...row.decision,
        id: row.id,
        researchRunId: row.researchRunId,
        wave: row.wave,
        createdAt: row.createdAt,
      })),
      modelCallUsage: modelCallUsageRows.map((row) => ({
        ...row,
        researchRunId: row.researchRunId ?? null,
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
        error: row.error ?? null,
      })),
      tradeabilityDecisions: tradeabilityDecisionRows.map((row) => row.record),
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

  async createResearchRun(input: {
    controlRunId: string;
    angle: string;
    queryPlan: unknown;
  }): Promise<ResearchRunRecord> {
    const record: ResearchRunRecord = {
      researchRunId: randomUUID(),
      controlRunId: input.controlRunId,
      angle: input.angle,
      status: "running",
      queryPlan: input.queryPlan,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };

    await this.db.insert(researchRuns).values(record);
    return record;
  }

  async updateResearchRun(input: {
    researchRunId: string;
    status: ResearchRunRecord["status"];
    queryPlan?: unknown;
    completedAt?: string | null;
    error?: string | null;
  }): Promise<ResearchRunRecord> {
    const rows = await this.db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.researchRunId, input.researchRunId))
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      throw new Error(`Research run ${input.researchRunId} was not found.`);
    }
    const updated: ResearchRunRecord = {
      ...existing,
      queryPlan: input.queryPlan ?? existing.queryPlan,
      status: input.status,
      completedAt: input.completedAt === undefined ? existing.completedAt ?? null : input.completedAt,
      error: input.error === undefined ? existing.error ?? null : input.error,
    };
    await this.db
      .update(researchRuns)
      .set({
        status: updated.status,
        queryPlan: updated.queryPlan,
        completedAt: updated.completedAt,
        error: updated.error,
      })
      .where(eq(researchRuns.researchRunId, input.researchRunId));
    return updated;
  }

  async addResearchQueryJobs(researchRunId: string, jobs: QueryJob[]): Promise<ResearchQueryJobRecord[]> {
    const records = jobs.map((job): ResearchQueryJobRecord => ({
      ...job,
      researchRunId,
      status: "queued",
      startedAt: null,
      completedAt: null,
      error: null,
    }));
    if (records.length > 0) {
      await this.db.insert(researchQueryJobs).values(records.map((record) => ({
        id: record.id,
        researchRunId,
        job: record,
        wave: record.wave,
        lane: record.lane,
        provider: record.provider,
        querySpecId: record.querySpecId,
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        error: record.error,
      })));
    }
    return records;
  }

  async updateResearchQueryJobStatus(
    queryJobId: string,
    input: {
      status: ResearchQueryJobRecord["status"];
      startedAt?: string | null;
      completedAt?: string | null;
      error?: string | null;
    },
  ): Promise<ResearchQueryJobRecord | undefined> {
    const rows = await this.db
      .select()
      .from(researchQueryJobs)
      .where(eq(researchQueryJobs.id, queryJobId))
      .limit(1);
    const existing = rows[0];
    if (!existing) return undefined;
    const updated = {
      status: input.status,
      startedAt: input.startedAt ?? existing.startedAt ?? null,
      completedAt: input.completedAt ?? existing.completedAt ?? null,
      error: input.error ?? existing.error ?? null,
    };
    await this.db
      .update(researchQueryJobs)
      .set(updated)
      .where(eq(researchQueryJobs.id, queryJobId));
    return {
      ...existing.job,
      researchRunId: existing.researchRunId,
      ...updated,
    };
  }

  async addResearchEvidenceLedger(researchRunId: string, ledger: EvidenceLedger): Promise<void> {
    if (ledger.searchResults.length > 0) {
      await this.db.insert(researchSearchResults).values(ledger.searchResults.map((result) => ({
        id: result.id,
        researchRunId,
        queryJobId: result.queryJobId,
        queryId: result.queryId,
        wave: result.wave,
        lane: result.lane,
        provider: result.provider,
        sourceType: result.sourceType,
        url: result.url,
        result,
        retrievedAt: result.retrievedAt,
      })));
    }
    if (ledger.evidenceClaims.length > 0) {
      await this.db.insert(researchEvidenceClaims).values(ledger.evidenceClaims.map((claim) => ({
        id: claim.id,
        researchRunId,
        resultId: claim.resultId,
        queryJobId: claim.queryJobId,
        wave: claim.wave,
        sourceType: claim.sourceType,
        directness: claim.directness,
        reliability: claim.reliability,
        claim,
      })));
    }
    if (ledger.goalEvidenceLinks.length > 0) {
      await this.db.insert(researchGoalEvidenceLinks).values(ledger.goalEvidenceLinks.map((link) => ({
        id: link.id,
        researchRunId,
        goalId: link.goalId,
        evidenceClaimId: link.evidenceClaimId,
        stance: link.stance,
        link,
      })));
    }
  }

  async addResearchGoalResolutions(
    researchRunId: string,
    wave: number,
    resolutions: GoalResolution[],
  ) {
    const records = resolutions.map((resolution) => ({
      ...resolution,
      id: randomUUID(),
      researchRunId,
      wave,
      createdAt: new Date().toISOString(),
    }));
    if (records.length > 0) {
      await this.db.insert(researchGoalResolutions).values(records.map((record) => ({
        id: record.id,
        researchRunId,
        wave,
        goalId: record.goalId,
        status: record.status,
        confidence: record.confidence,
        resolution: record,
        createdAt: record.createdAt,
      })));
    }
    return records;
  }

  async addResearchContinuationDecision(input: {
    researchRunId: string;
    wave: number;
    decision: ResearchContinuationDecision;
  }) {
    const record = {
      ...input.decision,
      id: randomUUID(),
      researchRunId: input.researchRunId,
      wave: input.wave,
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(researchContinuationDecisions).values({
      id: record.id,
      researchRunId: input.researchRunId,
      wave: input.wave,
      action: input.decision.action,
      decision: input.decision,
      createdAt: record.createdAt,
    });
    return record;
  }

  async addModelCallUsage(input: NewModelCallUsage) {
    const record = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(modelCallUsage).values(record);
    return record;
  }

  async addTradeabilityDecision(input: NewTradeabilityDecision) {
    const record = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(tradeabilityDecisions).values({
      id: record.id,
      controlRunId: record.controlRunId,
      researchRunId: record.researchRunId,
      decision: record.decision,
      directTradability: record.directTradability,
      record,
      createdAt: record.createdAt,
    });
    return record;
  }

  async addTradeTicket(ticket: TradeTicket): Promise<TradeTicket> {
    const now = new Date().toISOString();
    await this.db.insert(tradeTickets).values({
      ticketId: ticket.ticketId,
      runId: ticket.runId ?? null,
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
        runId: ticket.runId ?? null,
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
