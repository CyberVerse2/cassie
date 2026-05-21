import { z } from "zod";
import {
  GoogleImportantStructuredClient,
  DirectDeepSeekStructuredClient,
} from "../ai/client.ts";
import { CompositeMarketDataProvider } from "../market-data/index.ts";
import { LiveResearchSearchLanes } from "../research/lanes.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../execution/account-state.ts";
import {
  createQueuedExecutionJob,
  type ExecutionClient,
} from "../execution/index.ts";
import {
  SourcePostSchema,
  UserSettingsSchema,
  type ControlRun,
  type SourcePost,
  type UserSettings,
} from "../core/schemas/index.ts";
import { DrizzleCassieStore } from "../db/drizzle-store.ts";
import type { CassieStore } from "../db/store.ts";
import type { CassieDependencies } from "./dependencies.ts";
import { pollXMentions } from "./x-polling.ts";
import {
  GraphileExecutionJobQueue,
  executeExecutionJob,
  type CassieJobQueue,
} from "./execution-jobs.ts";

export const MentionRequestSchema = z.object({
  userId: z.string(),
  userCommand: z.string().min(1),
  sourcePost: SourcePostSchema,
});

export const SettingsRequestSchema = UserSettingsSchema;

export class CassieProduct {
  private static defaultDependencies(): CassieDependencies {
    const cheapAi = new DirectDeepSeekStructuredClient();
    const importantAi = new GoogleImportantStructuredClient();
    return {
      ai: cheapAi,
      cheapAi,
      importantAi,
      marketData: new CompositeMarketDataProvider(),
      researchLanes: new LiveResearchSearchLanes(),
    };
  }

  constructor(
    private readonly store: CassieStore = new DrizzleCassieStore(),
    private readonly deps: CassieDependencies | undefined = CassieProduct.defaultDependencies(),
    private readonly executionClient: ExecutionClient | null = null,
    private readonly accountStateProvider: AccountStateProvider | undefined = new HyperliquidAccountStateProvider(),
    private readonly jobQueue: CassieJobQueue = new GraphileExecutionJobQueue(),
  ) {}

  async upsertSettings(settings: UserSettings): Promise<UserSettings> {
    await this.store.upsertUserSettings(settings);
    return settings;
  }

  async createMentionRun(input: {
    userId: string;
    userCommand: string;
    sourcePost: SourcePost;
  }): Promise<{ runId: string; status: ControlRun["status"] }> {
    const userSettings = await this.store.getUserSettings(input.userId);

    if (!userSettings) {
      throw new Error(`No Cassie settings found for user ${input.userId}.`);
    }

    await this.store.addMention(input);
    const run = await this.store.createRun(input);
    await this.store.addRunStep({
      runId: run.runId,
      stepType: "intake",
      status: "succeeded",
      input,
      output: { queued: true },
      error: null,
      model: null,
      promptName: null,
      promptVersion: null,
      completedAt: new Date().toISOString(),
    });
    await this.jobQueue.enqueueSupervisor(run);
    return { runId: run.runId, status: run.status };
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

  async getRun(runId: string) {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} was not found.`);
    }

    return {
      run,
      steps: await this.store.getRunSteps(runId),
    };
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
      accountStateProvider: this.accountProvider(),
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
    const queued = await this.jobQueue.enqueueExecution(job);
    await this.store.audit({
      entityId: job.jobId,
      entityType: "execution_job",
      eventType: "execution_job.queued",
      message: "Execution job queued.",
      data: { ticketId: ticket.ticketId, graphileJobId: queued.graphileJobId },
    });
    return job;
  }

  private dependencies(): CassieDependencies {
    return this.deps ?? CassieProduct.defaultDependencies();
  }

  private accountProvider(): AccountStateProvider {
    return this.accountStateProvider ?? new HyperliquidAccountStateProvider();
  }
}
