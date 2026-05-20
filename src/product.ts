import { z } from "zod";
import { OpenAiStructuredClient } from "./ai.ts";
import { CompositeMarketDataProvider } from "./connectors/market-data.ts";
import { LiveResearchSearchLanes } from "./connectors/research-lanes.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "./account-state.ts";
import {
  createQueuedExecutionJob,
  type ExecutionClient,
} from "./execution.ts";
import {
  SourcePostSchema,
  UserSettingsSchema,
  type ResearchReport,
  type SourcePost,
  type UserSettings,
} from "./schemas.ts";
import { DrizzleCassieStore } from "./db/store.ts";
import type { CassieStore } from "./store.ts";
import { runCassie, type CassieDependencies, type CassieRun } from "./supervisor.ts";
import { pollXMentions } from "./x-polling.ts";
import {
  GraphileExecutionJobQueue,
  executeExecutionJob,
  type ExecutionJobQueue,
} from "./jobs/execution-jobs.ts";

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
    private readonly executionClient: ExecutionClient | null = null,
    private readonly accountStateProvider: AccountStateProvider = new HyperliquidAccountStateProvider(),
    private readonly executionJobQueue: ExecutionJobQueue = new GraphileExecutionJobQueue(),
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
    const accountState = await this.accountStateProvider.getAccountState(userSettings);
    const run = await runCassie({
      deps: this.deps,
      sourcePost: input.sourcePost,
      userSettings,
      accountState,
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
        await this.enqueueExecution(run.tradeTicket);
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

    const job = await this.enqueueExecution(approvedTicket);
    return { ticketId, executionJobId: job.jobId };
  }

  async state() {
    return this.store.load();
  }

  async processNextExecutionJob() {
    const queuedJob = await this.store.getNextQueuedExecutionJob();
    if (!queuedJob) {
      return { processed: false, reason: "No queued execution jobs." };
    }

    const job = await executeExecutionJob({
      jobId: queuedJob.jobId,
      store: this.store,
      executionClient: this.executionClient ?? undefined,
    });
    return { processed: true, job };
  }

  async pollXMentions(userId: string) {
    return pollXMentions({
      product: this,
      store: this.store,
      userId,
    });
  }

  private async enqueueExecution(ticket: Awaited<ReturnType<CassieStore["getTradeTicket"]>>) {
    if (!ticket) {
      throw new Error("Cannot execute a missing ticket.");
    }

    const job = await this.store.addExecutionJob(createQueuedExecutionJob(ticket.ticketId));
    const queued = await this.executionJobQueue.enqueue(job);
    await this.store.audit({
      entityId: job.jobId,
      entityType: "execution_job",
      eventType: "execution_job.queued",
      message: "Execution job queued.",
      data: { ticketId: ticket.ticketId, graphileJobId: queued.graphileJobId },
    });
    return job;
  }
}

function getResearchReport(run: CassieRun): ResearchReport | undefined {
  if (run.responseType === "analysis") {
    return undefined;
  }

  return run.researchReport;
}
