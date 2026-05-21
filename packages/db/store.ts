import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ControlRun,
  EvidenceClaim,
  EvidenceLedger,
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
} from "../core/schemas/index.ts";

export interface MentionRecord {
  mentionId: string;
  userId: string;
  userCommand: string;
  sourcePost: SourcePost;
  createdAt: string;
}

export interface ResearchReportRecord {
  reportId: string;
  runId: string;
  report: ResearchReport;
  createdAt: string;
}

export interface ResearchRunRecord {
  researchRunId: string;
  controlRunId: string;
  angle: string;
  status: "running" | "succeeded" | "failed";
  queryPlan: unknown;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface ResearchQueryJobRecord extends QueryJob {
  researchRunId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface ResearchSearchResultRecord extends SearchResult {
  researchRunId: string;
}

export interface ResearchEvidenceClaimRecord extends EvidenceClaim {
  researchRunId: string;
}

export interface ResearchGoalEvidenceLinkRecord extends GoalEvidenceLink {
  researchRunId: string;
}

export interface ResearchGoalResolutionRecord extends GoalResolution {
  id: string;
  researchRunId: string;
  wave: number;
  createdAt: string;
}

export interface ResearchContinuationDecisionRecord extends ResearchContinuationDecision {
  id: string;
  researchRunId: string;
  wave: number;
  createdAt: string;
}

export interface ModelCallUsageRecord {
  id: string;
  controlRunId: string;
  researchRunId: string | null;
  runStepId: string | null;
  purpose: string;
  provider: string;
  model: string;
  promptName: string | null;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  status: "succeeded" | "failed";
  error: string | null;
  createdAt: string;
}

export interface TradeabilityDecisionRecord {
  id: string;
  controlRunId: string;
  researchRunId: string | null;
  decision:
    | "block_trade"
    | "watchlist_only"
    | "private_market_research"
    | "prediction_market_candidate"
    | "public_market_candidate"
    | "crypto_market_candidate"
    | "needs_more_research";
  directTradability: "direct" | "proxy" | "prediction_market" | "private_only" | "none" | "unknown";
  blockingGoalIds: string[];
  requiredResolvedGoalIds: string[];
  rationale: string;
  allowedExpressions: Array<Record<string, unknown>>;
  blockedExpressions: Array<Record<string, unknown>>;
  createdAt: string;
}

export type NewModelCallUsage = Omit<ModelCallUsageRecord, "id" | "createdAt">;
export type NewTradeabilityDecision = Omit<TradeabilityDecisionRecord, "id" | "createdAt">;

export interface CassieStoreSnapshot {
  mentions: MentionRecord[];
  researchReports: ResearchReportRecord[];
  tradeTickets: TradeTicket[];
  executionJobs: ExecutionJob[];
  auditEvents: AuditEvent[];
  userSettings: UserSettings[];
  controlRuns: ControlRun[];
  runSteps: RunStep[];
  researchRuns: ResearchRunRecord[];
  researchQueryJobs: ResearchQueryJobRecord[];
  researchSearchResults: ResearchSearchResultRecord[];
  researchEvidenceClaims: ResearchEvidenceClaimRecord[];
  researchGoalEvidenceLinks: ResearchGoalEvidenceLinkRecord[];
  researchGoalResolutions: ResearchGoalResolutionRecord[];
  researchContinuationDecisions: ResearchContinuationDecisionRecord[];
  modelCallUsage: ModelCallUsageRecord[];
  tradeabilityDecisions: TradeabilityDecisionRecord[];
}

export type NewRunStep = Omit<RunStep, "stepId" | "startedAt" | "completedAt"> & {
  completedAt?: string | null;
};

export interface CassieStore {
  load(): Promise<CassieStoreSnapshot>;
  upsertUserSettings(settings: UserSettings): Promise<void>;
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  createRun(input: {
    userId: string;
    userCommand: string;
    sourcePost: SourcePost;
  }): Promise<ControlRun>;
  updateRun(run: ControlRun): Promise<ControlRun>;
  getRun(runId: string): Promise<ControlRun | undefined>;
  addRunStep(input: NewRunStep): Promise<RunStep>;
  updateRunStep(step: RunStep): Promise<RunStep>;
  getRunSteps(runId: string): Promise<RunStep[]>;
  addMention(input: Omit<MentionRecord, "mentionId" | "createdAt">): Promise<MentionRecord>;
  addResearchReport(input: {
    runId: string;
    report: ResearchReport;
  }): Promise<ResearchReportRecord>;
  createResearchRun(input: {
    controlRunId: string;
    angle: string;
    queryPlan: unknown;
  }): Promise<ResearchRunRecord>;
  updateResearchRun(input: {
    researchRunId: string;
    status: ResearchRunRecord["status"];
    queryPlan?: unknown;
    completedAt?: string | null;
    error?: string | null;
  }): Promise<ResearchRunRecord>;
  addResearchQueryJobs(researchRunId: string, jobs: QueryJob[]): Promise<ResearchQueryJobRecord[]>;
  updateResearchQueryJobStatus(
    queryJobId: string,
    input: {
      status: ResearchQueryJobRecord["status"];
      startedAt?: string | null;
      completedAt?: string | null;
      error?: string | null;
    },
  ): Promise<ResearchQueryJobRecord | undefined>;
  addResearchEvidenceLedger(researchRunId: string, ledger: EvidenceLedger): Promise<void>;
  addResearchGoalResolutions(
    researchRunId: string,
    wave: number,
    resolutions: GoalResolution[],
  ): Promise<ResearchGoalResolutionRecord[]>;
  addResearchContinuationDecision(input: {
    researchRunId: string;
    wave: number;
    decision: ResearchContinuationDecision;
  }): Promise<ResearchContinuationDecisionRecord>;
  addModelCallUsage(input: NewModelCallUsage): Promise<ModelCallUsageRecord>;
  addTradeabilityDecision(input: NewTradeabilityDecision): Promise<TradeabilityDecisionRecord>;
  addTradeTicket(ticket: TradeTicket): Promise<TradeTicket>;
  updateTradeTicket(ticket: TradeTicket): Promise<TradeTicket>;
  getTradeTicket(ticketId: string): Promise<TradeTicket | undefined>;
  addExecutionJob(job: ExecutionJob): Promise<ExecutionJob>;
  updateExecutionJob(job: ExecutionJob): Promise<ExecutionJob>;
  getNextQueuedExecutionJob(): Promise<ExecutionJob | undefined>;
  getRuntimeState<T = unknown>(key: string): Promise<T | undefined>;
  setRuntimeState(key: string, value: unknown): Promise<void>;
  audit(input: Omit<AuditEvent, "eventId" | "createdAt">): Promise<AuditEvent>;
}

const emptySnapshot = (): CassieStoreSnapshot => ({
  mentions: [],
  researchReports: [],
  tradeTickets: [],
  executionJobs: [],
  auditEvents: [],
  userSettings: [],
  controlRuns: [],
  runSteps: [],
  researchRuns: [],
  researchQueryJobs: [],
  researchSearchResults: [],
  researchEvidenceClaims: [],
  researchGoalEvidenceLinks: [],
  researchGoalResolutions: [],
  researchContinuationDecisions: [],
  modelCallUsage: [],
  tradeabilityDecisions: [],
});

export class InMemoryCassieStore implements CassieStore {
  private snapshot = emptySnapshot();
  private runtimeState = new Map<string, unknown>();

  async load(): Promise<CassieStoreSnapshot> {
    return structuredClone(this.snapshot);
  }

  async upsertUserSettings(settings: UserSettings): Promise<void> {
    this.snapshot.userSettings = this.snapshot.userSettings.filter(
      (candidate) => candidate.userId !== settings.userId,
    );
    this.snapshot.userSettings.push(settings);
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    return this.snapshot.userSettings.find((settings) => settings.userId === userId);
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
    this.snapshot.controlRuns.push(run);
    return run;
  }

  async updateRun(run: ControlRun): Promise<ControlRun> {
    this.snapshot.controlRuns = this.snapshot.controlRuns.map((candidate) =>
      candidate.runId === run.runId ? run : candidate,
    );
    return run;
  }

  async getRun(runId: string): Promise<ControlRun | undefined> {
    return this.snapshot.controlRuns.find((run) => run.runId === runId);
  }

  async addRunStep(input: NewRunStep): Promise<RunStep> {
    const step: RunStep = {
      ...input,
      stepId: randomUUID(),
      startedAt: new Date().toISOString(),
      completedAt: input.completedAt ?? null,
    };
    this.snapshot.runSteps.push(step);
    return step;
  }

  async updateRunStep(step: RunStep): Promise<RunStep> {
    this.snapshot.runSteps = this.snapshot.runSteps.map((candidate) =>
      candidate.stepId === step.stepId ? step : candidate,
    );
    return step;
  }

  async getRunSteps(runId: string): Promise<RunStep[]> {
    return this.snapshot.runSteps.filter((step) => step.runId === runId);
  }

  async addMention(input: Omit<MentionRecord, "mentionId" | "createdAt">): Promise<MentionRecord> {
    const mention: MentionRecord = {
      ...input,
      mentionId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.snapshot.mentions.push(mention);
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
    this.snapshot.researchReports.push(record);
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
    this.snapshot.researchRuns.push(record);
    return record;
  }

  async updateResearchRun(input: {
    researchRunId: string;
    status: ResearchRunRecord["status"];
    queryPlan?: unknown;
    completedAt?: string | null;
    error?: string | null;
  }): Promise<ResearchRunRecord> {
    const existing = this.snapshot.researchRuns.find((run) => run.researchRunId === input.researchRunId);
    if (!existing) {
      throw new Error(`Research run ${input.researchRunId} was not found.`);
    }
    const updated: ResearchRunRecord = {
      ...existing,
      status: input.status,
      queryPlan: input.queryPlan ?? existing.queryPlan,
      completedAt: input.completedAt === undefined ? existing.completedAt : input.completedAt,
      error: input.error === undefined ? existing.error : input.error,
    };
    this.snapshot.researchRuns = this.snapshot.researchRuns.map((run) =>
      run.researchRunId === updated.researchRunId ? updated : run,
    );
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
    this.snapshot.researchQueryJobs.push(...records);
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
    let updated: ResearchQueryJobRecord | undefined;
    this.snapshot.researchQueryJobs = this.snapshot.researchQueryJobs.map((job) => {
      if (job.id !== queryJobId) return job;
      updated = {
        ...job,
        status: input.status,
        startedAt: input.startedAt ?? job.startedAt,
        completedAt: input.completedAt ?? job.completedAt,
        error: input.error ?? job.error,
      };
      return updated;
    });
    return updated;
  }

  async addResearchEvidenceLedger(researchRunId: string, ledger: EvidenceLedger): Promise<void> {
    this.snapshot.researchSearchResults.push(
      ...ledger.searchResults.map((result) => ({ ...result, researchRunId })),
    );
    this.snapshot.researchEvidenceClaims.push(
      ...ledger.evidenceClaims.map((claim) => ({ ...claim, researchRunId })),
    );
    this.snapshot.researchGoalEvidenceLinks.push(
      ...ledger.goalEvidenceLinks.map((link) => ({ ...link, researchRunId })),
    );
  }

  async addResearchGoalResolutions(
    researchRunId: string,
    wave: number,
    resolutions: GoalResolution[],
  ): Promise<ResearchGoalResolutionRecord[]> {
    const records = resolutions.map((resolution): ResearchGoalResolutionRecord => ({
      ...resolution,
      id: randomUUID(),
      researchRunId,
      wave,
      createdAt: new Date().toISOString(),
    }));
    this.snapshot.researchGoalResolutions.push(...records);
    return records;
  }

  async addResearchContinuationDecision(input: {
    researchRunId: string;
    wave: number;
    decision: ResearchContinuationDecision;
  }): Promise<ResearchContinuationDecisionRecord> {
    const record: ResearchContinuationDecisionRecord = {
      ...input.decision,
      id: randomUUID(),
      researchRunId: input.researchRunId,
      wave: input.wave,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.researchContinuationDecisions.push(record);
    return record;
  }

  async addModelCallUsage(input: NewModelCallUsage): Promise<ModelCallUsageRecord> {
    const record: ModelCallUsageRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.snapshot.modelCallUsage.push(record);
    return record;
  }

  async addTradeabilityDecision(input: NewTradeabilityDecision): Promise<TradeabilityDecisionRecord> {
    const record: TradeabilityDecisionRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.snapshot.tradeabilityDecisions.push(record);
    return record;
  }

  async addTradeTicket(ticket: TradeTicket): Promise<TradeTicket> {
    this.snapshot.tradeTickets.push(ticket);
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
    this.snapshot.tradeTickets = this.snapshot.tradeTickets.map((candidate) =>
      candidate.ticketId === ticket.ticketId ? ticket : candidate,
    );
    return ticket;
  }

  async getTradeTicket(ticketId: string): Promise<TradeTicket | undefined> {
    return this.snapshot.tradeTickets.find((ticket) => ticket.ticketId === ticketId);
  }

  async addExecutionJob(job: ExecutionJob): Promise<ExecutionJob> {
    this.snapshot.executionJobs.push(job);
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
    this.snapshot.executionJobs = this.snapshot.executionJobs.map((candidate) =>
      candidate.jobId === job.jobId ? job : candidate,
    );
    return job;
  }

  async getNextQueuedExecutionJob(): Promise<ExecutionJob | undefined> {
    return this.snapshot.executionJobs.find((job) => job.status === "queued");
  }

  async getRuntimeState<T = unknown>(key: string): Promise<T | undefined> {
    return this.runtimeState.get(key) as T | undefined;
  }

  async setRuntimeState(key: string, value: unknown): Promise<void> {
    this.runtimeState.set(key, value);
  }

  async audit(input: Omit<AuditEvent, "eventId" | "createdAt">): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      eventId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.snapshot.auditEvents.push(event);
    return event;
  }
}
