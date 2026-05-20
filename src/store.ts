import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ExecutionJob,
  ResearchReport,
  SourcePost,
  StoredRun,
  TradeTicket,
  UserSettings,
} from "./schemas.js";

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
  runs: StoredRun[];
  researchReports: ResearchReportRecord[];
  tradeTickets: TradeTicket[];
  executionJobs: ExecutionJob[];
  auditEvents: AuditEvent[];
  userSettings: UserSettings[];
}

export interface CassieStore {
  load(): Promise<CassieStoreSnapshot>;
  upsertUserSettings(settings: UserSettings): Promise<void>;
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  addMention(input: Omit<MentionRecord, "mentionId" | "createdAt">): Promise<MentionRecord>;
  addRun(run: Omit<StoredRun, "runId" | "createdAt">): Promise<StoredRun>;
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
  audit(input: Omit<AuditEvent, "eventId" | "createdAt">): Promise<AuditEvent>;
}

const emptySnapshot = (): CassieStoreSnapshot => ({
  mentions: [],
  runs: [],
  researchReports: [],
  tradeTickets: [],
  executionJobs: [],
  auditEvents: [],
  userSettings: [],
});

export class InMemoryCassieStore implements CassieStore {
  private snapshot = emptySnapshot();

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

  async addRun(run: Omit<StoredRun, "runId" | "createdAt">): Promise<StoredRun> {
    const storedRun: StoredRun = {
      ...run,
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.snapshot.runs.push(storedRun);
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
