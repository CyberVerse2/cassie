import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

const emptySnapshot = (): CassieStoreSnapshot => ({
  mentions: [],
  runs: [],
  researchReports: [],
  tradeTickets: [],
  executionJobs: [],
  auditEvents: [],
  userSettings: [],
});

export class FileCassieStore {
  constructor(private readonly filePath = ".cassie-data/store.json") {}

  async load(): Promise<CassieStoreSnapshot> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...emptySnapshot(), ...JSON.parse(raw) };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return emptySnapshot();
      }

      throw error;
    }
  }

  async save(snapshot: CassieStoreSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  async upsertUserSettings(settings: UserSettings): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.userSettings = snapshot.userSettings.filter(
        (candidate) => candidate.userId !== settings.userId,
      );
      snapshot.userSettings.push(settings);
    });
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const snapshot = await this.load();
    return snapshot.userSettings.find((settings) => settings.userId === userId);
  }

  async addMention(input: Omit<MentionRecord, "mentionId" | "createdAt">): Promise<MentionRecord> {
    const mention: MentionRecord = {
      ...input,
      mentionId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.mutate((snapshot) => {
      snapshot.mentions.push(mention);
    });

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

    await this.mutate((snapshot) => {
      snapshot.runs.push(storedRun);
    });

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

    await this.mutate((snapshot) => {
      snapshot.researchReports.push(record);
    });

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
    await this.mutate((snapshot) => {
      snapshot.tradeTickets.push(ticket);
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
    await this.mutate((snapshot) => {
      snapshot.tradeTickets = snapshot.tradeTickets.map((candidate) =>
        candidate.ticketId === ticket.ticketId ? ticket : candidate,
      );
    });

    return ticket;
  }

  async getTradeTicket(ticketId: string): Promise<TradeTicket | undefined> {
    const snapshot = await this.load();
    return snapshot.tradeTickets.find((ticket) => ticket.ticketId === ticketId);
  }

  async addExecutionJob(job: ExecutionJob): Promise<ExecutionJob> {
    await this.mutate((snapshot) => {
      snapshot.executionJobs.push(job);
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
    await this.mutate((snapshot) => {
      snapshot.executionJobs = snapshot.executionJobs.map((candidate) =>
        candidate.jobId === job.jobId ? job : candidate,
      );
    });

    return job;
  }

  async audit(input: Omit<AuditEvent, "eventId" | "createdAt">): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      eventId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.mutate((snapshot) => {
      snapshot.auditEvents.push(event);
    });

    return event;
  }

  private async mutate(mutator: (snapshot: CassieStoreSnapshot) => void): Promise<void> {
    const snapshot = await this.load();
    mutator(snapshot);
    await this.save(snapshot);
  }
}
