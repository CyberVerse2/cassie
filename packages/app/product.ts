import {
  type ExecutionClient,
} from "../execution/index.ts";
import {
  type ControlRun,
  type SourcePost,
  type UserSettings,
} from "../core/schemas/index.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import { pollXMentions } from "./x-polling.ts";
import { pollTelegramUpdates } from "../notifications/telegram.ts";
import {
  GraphileExecutionJobQueue,
  type CassieJobQueue,
} from "../jobs/queue.ts";
import {
  executeExecutionJob,
} from "../jobs/execution-job.ts";

export class CassieProduct {
  constructor(
    private readonly store: CassieStore = new DrizzleCassieStore(),
    private readonly executionClient: ExecutionClient | null = null,
    _legacyAccountStateProvider: unknown = undefined,
    private readonly jobQueue: CassieJobQueue = new GraphileExecutionJobQueue(),
  ) {
    void _legacyAccountStateProvider;
  }

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

  async pollTelegramUpdates() {
    return pollTelegramUpdates({
      store: this.store,
    });
  }

}
