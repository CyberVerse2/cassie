import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ControlRun,
  ExecutionJob,
  ResearchReport,
  RunStep,
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

export interface CassieStoreSnapshot {
  mentions: MentionRecord[];
  researchReports: ResearchReportRecord[];
  tradeTickets: TradeTicket[];
  executionJobs: ExecutionJob[];
  auditEvents: AuditEvent[];
  userSettings: UserSettings[];
  controlRuns: ControlRun[];
  runSteps: RunStep[];
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
