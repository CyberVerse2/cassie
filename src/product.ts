import { z } from "zod";
import { OpenAiStructuredClient } from "./ai.js";
import { CompositeMarketDataProvider } from "./connectors/market-data.js";
import { LiveResearchSearchLanes } from "./connectors/research-lanes.js";
import {
  WebhookExecutionClient,
  createQueuedExecutionJob,
  markExecutionFailed,
  markExecutionRunning,
  markExecutionSucceeded,
  type ExecutionClient,
} from "./execution.js";
import {
  SourcePostSchema,
  UserSettingsSchema,
  type ResearchReport,
  type SourcePost,
  type UserSettings,
} from "./schemas.js";
import { DrizzleCassieStore } from "./db/store.js";
import type { CassieStore } from "./store.js";
import { runCassie, type CassieDependencies, type CassieRun } from "./supervisor.js";

export const MentionRequestSchema = z.object({
  userId: z.string(),
  userCommand: z.string().min(1),
  sourcePost: SourcePostSchema,
});

export const SettingsRequestSchema = UserSettingsSchema;

export class CassieProduct {
  constructor(
    private readonly store: CassieStore = new DrizzleCassieStore(),
    private readonly deps: CassieDependencies = {
      ai: new OpenAiStructuredClient(),
      marketData: new CompositeMarketDataProvider(),
      researchLanes: new LiveResearchSearchLanes(),
    },
    private readonly executionClient: ExecutionClient = new WebhookExecutionClient(),
  ) {}

  async upsertSettings(settings: UserSettings): Promise<UserSettings> {
    await this.store.upsertUserSettings(settings);
    return settings;
  }

  async processMention(input: {
    userId: string;
    userCommand: string;
    sourcePost: SourcePost;
  }): Promise<{ run: CassieRun; state: Awaited<ReturnType<CassieStore["load"]>> }> {
    const userSettings = await this.store.getUserSettings(input.userId);

    if (!userSettings) {
      throw new Error(`No Cassie settings found for user ${input.userId}.`);
    }

    const mention = await this.store.addMention(input);
    const run = await runCassie({
      deps: this.deps,
      sourcePost: input.sourcePost,
      userSettings,
      userCommand: input.userCommand,
    });

    const storedRun = await this.store.addRun({
      mentionId: mention.mentionId,
      userId: input.userId,
      userCommand: input.userCommand,
      sourcePost: input.sourcePost,
      responseType: run.responseType,
      result: run,
    });

    const researchReport = getResearchReport(run);
    if (researchReport) {
      await this.store.addResearchReport({
        runId: storedRun.runId,
        report: researchReport,
      });
    }

    if (run.responseType === "trade_ticket") {
      await this.store.addTradeTicket(run.tradeTicket);
      if (run.tradeTicket.approvalState === "not_required") {
        await this.executeTicket(run.tradeTicket);
      }
    }

    return { run, state: await this.store.load() };
  }

  async approveTicket(ticketId: string): Promise<{ ticketId: string; executionJobId: string }> {
    const ticket = await this.store.getTradeTicket(ticketId);

    if (!ticket) {
      throw new Error(`Trade ticket ${ticketId} was not found.`);
    }

    if (ticket.approvalState === "rejected") {
      throw new Error(`Trade ticket ${ticketId} was rejected.`);
    }

    const approvedTicket = {
      ...ticket,
      approvalState: "approved" as const,
    };
    await this.store.updateTradeTicket(approvedTicket);
    await this.store.audit({
      entityId: ticketId,
      entityType: "trade_ticket",
      eventType: "trade_ticket.approved",
      message: "Trade ticket approved.",
      data: { ticketId },
    });

    const job = await this.executeTicket(approvedTicket);
    return { ticketId, executionJobId: job.jobId };
  }

  async state() {
    return this.store.load();
  }

  private async executeTicket(ticket: Awaited<ReturnType<CassieStore["getTradeTicket"]>>) {
    if (!ticket) {
      throw new Error("Cannot execute a missing ticket.");
    }

    let job = await this.store.addExecutionJob(createQueuedExecutionJob(ticket.ticketId));
    job = await this.store.updateExecutionJob(markExecutionRunning(job));

    try {
      const executionResult = await this.executionClient.execute(ticket);
      job = await this.store.updateExecutionJob(markExecutionSucceeded(job, executionResult));
      await this.store.audit({
        entityId: job.jobId,
        entityType: "execution_job",
        eventType: "execution_job.succeeded",
        message: "Execution job succeeded.",
        data: executionResult,
      });
    } catch (error) {
      job = await this.store.updateExecutionJob(
        markExecutionFailed(job, error instanceof Error ? error.message : String(error)),
      );
      await this.store.audit({
        entityId: job.jobId,
        entityType: "execution_job",
        eventType: "execution_job.failed",
        message: "Execution job failed.",
        data: { failureReason: job.failureReason },
      });
    }

    return job;
  }
}

function getResearchReport(run: CassieRun): ResearchReport | undefined {
  if (run.responseType === "analysis") {
    return undefined;
  }

  return run.researchReport;
}
