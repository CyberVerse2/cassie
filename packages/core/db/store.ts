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

export interface MentionRecord {
  mentionId: string;
  userId: string;
  userCommand: string;
  sourcePost: SourcePost;
  createdAt: string;
}

export interface ModelCallUsageRecord {
  id: string;
  controlRunId: string;
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
  thinkingTrace?: string | null;
  status: "succeeded" | "failed";
  error: string | null;
  createdAt: string;
}

export type NewModelCallUsage = Omit<ModelCallUsageRecord, "id" | "createdAt">;

export interface CassieStoreSnapshot {
  mentions: MentionRecord[];
  tradeTickets: TradeTicket[];
  executionJobs: ExecutionJob[];
  custodyBalances: CustodyBalance[];
  custodyLedgerEntries: CustodyLedgerEntry[];
  auditEvents: AuditEvent[];
  userSettings: UserSettings[];
  controlRuns: ControlRun[];
  runSteps: RunStep[];
  modelCallUsage: ModelCallUsageRecord[];
}

export type NewRunStep = Omit<RunStep, "stepId" | "startedAt" | "completedAt"> & {
  completedAt?: string | null;
};

export interface CassieStore {
  load(): Promise<CassieStoreSnapshot>;
  upsertUserSettings(settings: UserSettings): Promise<void>;
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  getUserSettingsByPrivyUserId(privyUserId: string): Promise<UserSettings | undefined>;
  syncPrivyUser(input: {
    privyUserId: string;
    privyWalletId: string | null;
    walletAddress: string | null;
    defaultTradeSizeUsd?: number;
  }): Promise<UserSettings>;
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
  addModelCallUsage(input: NewModelCallUsage): Promise<ModelCallUsageRecord>;
  addTradeTicket(ticket: TradeTicket): Promise<TradeTicket>;
  updateTradeTicket(ticket: TradeTicket): Promise<TradeTicket>;
  getTradeTicket(ticketId: string): Promise<TradeTicket | undefined>;
  addExecutionJob(job: ExecutionJob): Promise<ExecutionJob>;
  updateExecutionJob(job: ExecutionJob): Promise<ExecutionJob>;
  getExecutionJob(jobId: string): Promise<ExecutionJob | undefined>;
  creditUserBalance(input: {
    userId: string;
    amountUsd: number;
    source: string;
    externalRef?: string | null;
    metadata?: unknown;
  }): Promise<CustodyBalance>;
  getCustodyBalance(userId: string): Promise<CustodyBalance | undefined>;
  reserveTradeFunds(ticket: TradeTicket, job: ExecutionJob): Promise<CustodyBalance>;
  releaseTradeReservation(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    reason: string;
  }): Promise<CustodyBalance>;
  settleTradeReservation(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    executionResult: NonNullable<ExecutionJob["executionResult"]>;
  }): Promise<CustodyBalance>;
  listTradeTicketsWithoutExecutionJob(runId: string): Promise<TradeTicket[]>;
  getNextQueuedExecutionJob(): Promise<ExecutionJob | undefined>;
  getRuntimeState<T = unknown>(key: string): Promise<T | undefined>;
  setRuntimeState(key: string, value: unknown): Promise<void>;
  audit(input: Omit<AuditEvent, "eventId" | "createdAt">): Promise<AuditEvent>;
}

const emptySnapshot = (): CassieStoreSnapshot => ({
  mentions: [],
  tradeTickets: [],
  executionJobs: [],
  custodyBalances: [],
  custodyLedgerEntries: [],
  auditEvents: [],
  userSettings: [],
  controlRuns: [],
  runSteps: [],
  modelCallUsage: [],
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

  async getUserSettingsByPrivyUserId(privyUserId: string): Promise<UserSettings | undefined> {
    return this.snapshot.userSettings.find((settings) => settings.privyUserId === privyUserId);
  }

  async syncPrivyUser(input: {
    privyUserId: string;
    privyWalletId: string | null;
    walletAddress: string | null;
    defaultTradeSizeUsd?: number;
  }): Promise<UserSettings> {
    const existing = await this.getUserSettingsByPrivyUserId(input.privyUserId);
    const settings: UserSettings = {
      userId: existing?.userId ?? input.privyUserId,
      privyUserId: input.privyUserId,
      privyWalletId: input.privyWalletId,
      walletAddress: input.walletAddress,
      defaultTradeSizeUsd: input.defaultTradeSizeUsd ?? existing?.defaultTradeSizeUsd ?? 50,
    };
    await this.upsertUserSettings(settings);
    return settings;
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
      thinkingTrace: input.thinkingTrace ?? null,
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

  async addModelCallUsage(input: NewModelCallUsage): Promise<ModelCallUsageRecord> {
    const record: ModelCallUsageRecord = {
      ...input,
      id: randomUUID(),
      thinkingTrace: input.thinkingTrace ?? null,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.modelCallUsage.push(record);
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

  async getExecutionJob(jobId: string): Promise<ExecutionJob | undefined> {
    return this.snapshot.executionJobs.find((job) => job.jobId === jobId);
  }

  async creditUserBalance(input: {
    userId: string;
    amountUsd: number;
    source: string;
    externalRef?: string | null;
    metadata?: unknown;
  }): Promise<CustodyBalance> {
    assertPositiveAmount(input.amountUsd);
    if (input.externalRef && this.hasCustodyCredit(input.source, input.externalRef)) {
      const existing = await this.getCustodyBalance(input.userId);
      if (!existing) throw new Error(`No swept balance found for user ${input.userId}.`);
      return existing;
    }

    const now = new Date().toISOString();
    const balance = this.snapshot.custodyBalances.find((candidate) => candidate.userId === input.userId);
    const updated: CustodyBalance = {
      userId: input.userId,
      availableUsd: (balance?.availableUsd ?? 0) + input.amountUsd,
      reservedUsd: balance?.reservedUsd ?? 0,
      updatedAt: now,
    };
    this.upsertCustodyBalance(updated);
    this.snapshot.custodyLedgerEntries.push({
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
    return updated;
  }

  async getCustodyBalance(userId: string): Promise<CustodyBalance | undefined> {
    return this.snapshot.custodyBalances.find((balance) => balance.userId === userId);
  }

  async reserveTradeFunds(ticket: TradeTicket, job: ExecutionJob): Promise<CustodyBalance> {
    assertPositiveAmount(ticket.sizeUsd);
    if (this.hasCustodyEntry("trade_reserve", job.jobId)) {
      const existing = await this.getCustodyBalance(ticket.userId);
      if (!existing) throw new Error(`No swept balance found for user ${ticket.userId}.`);
      return existing;
    }

    const balance = await this.getCustodyBalance(ticket.userId);
    if (!balance || balance.availableUsd < ticket.sizeUsd) {
      throw new Error("Insufficient swept balance.");
    }

    const now = new Date().toISOString();
    const updated: CustodyBalance = {
      userId: ticket.userId,
      availableUsd: balance.availableUsd - ticket.sizeUsd,
      reservedUsd: balance.reservedUsd + ticket.sizeUsd,
      updatedAt: now,
    };
    this.upsertCustodyBalance(updated);
    this.snapshot.custodyLedgerEntries.push(tradeLedgerEntry({
      userId: ticket.userId,
      type: "trade_reserve",
      amountUsd: ticket.sizeUsd,
      ticketId: ticket.ticketId,
      executionJobId: job.jobId,
      metadata: { venue: ticket.venue, instrument: ticket.instrument, side: ticket.side },
      createdAt: now,
    }));
    return updated;
  }

  async releaseTradeReservation(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    reason: string;
  }): Promise<CustodyBalance> {
    if (this.hasCustodyEntry("trade_release", input.job.jobId)) {
      const existing = await this.getCustodyBalance(input.ticket.userId);
      if (!existing) throw new Error(`No swept balance found for user ${input.ticket.userId}.`);
      return existing;
    }

    const balance = await this.getCustodyBalance(input.ticket.userId);
    if (!balance || balance.reservedUsd < input.ticket.sizeUsd) {
      throw new Error("Cannot release a missing trade reservation.");
    }

    const now = new Date().toISOString();
    const updated: CustodyBalance = {
      userId: input.ticket.userId,
      availableUsd: balance.availableUsd + input.ticket.sizeUsd,
      reservedUsd: balance.reservedUsd - input.ticket.sizeUsd,
      updatedAt: now,
    };
    this.upsertCustodyBalance(updated);
    this.snapshot.custodyLedgerEntries.push(tradeLedgerEntry({
      userId: input.ticket.userId,
      type: "trade_release",
      amountUsd: input.ticket.sizeUsd,
      ticketId: input.ticket.ticketId,
      executionJobId: input.job.jobId,
      metadata: { reason: input.reason },
      createdAt: now,
    }));
    return updated;
  }

  async settleTradeReservation(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    executionResult: NonNullable<ExecutionJob["executionResult"]>;
  }): Promise<CustodyBalance> {
    if (this.hasCustodyEntry("trade_settlement", input.job.jobId)) {
      const existing = await this.getCustodyBalance(input.ticket.userId);
      if (!existing) throw new Error(`No swept balance found for user ${input.ticket.userId}.`);
      return existing;
    }

    const filledSizeUsd = normalizedFilledSize(input.ticket, input.executionResult);
    const releaseUsd = input.ticket.sizeUsd - filledSizeUsd;
    const balance = await this.getCustodyBalance(input.ticket.userId);
    if (!balance || balance.reservedUsd < input.ticket.sizeUsd) {
      throw new Error("Cannot settle a missing trade reservation.");
    }

    const now = new Date().toISOString();
    const updated: CustodyBalance = {
      userId: input.ticket.userId,
      availableUsd: balance.availableUsd + releaseUsd,
      reservedUsd: balance.reservedUsd - input.ticket.sizeUsd,
      updatedAt: now,
    };
    this.upsertCustodyBalance(updated);
    this.snapshot.custodyLedgerEntries.push(tradeLedgerEntry({
      userId: input.ticket.userId,
      type: "trade_settlement",
      amountUsd: filledSizeUsd,
      ticketId: input.ticket.ticketId,
      executionJobId: input.job.jobId,
      metadata: input.executionResult,
      createdAt: now,
    }));
    if (releaseUsd > 0) {
      this.snapshot.custodyLedgerEntries.push(tradeLedgerEntry({
        userId: input.ticket.userId,
        type: "trade_release",
        amountUsd: releaseUsd,
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        metadata: { reason: "unfilled_order_amount" },
        createdAt: now,
      }));
    }
    return updated;
  }

  async listTradeTicketsWithoutExecutionJob(runId: string): Promise<TradeTicket[]> {
    const existingExecutionTicketIds = new Set(this.snapshot.executionJobs.map((job) => job.ticketId));
    return this.snapshot.tradeTickets.filter((ticket) =>
      ticket.runId === runId &&
      !existingExecutionTicketIds.has(ticket.ticketId)
    );
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

  private upsertCustodyBalance(balance: CustodyBalance): void {
    this.snapshot.custodyBalances = this.snapshot.custodyBalances.filter(
      (candidate) => candidate.userId !== balance.userId,
    );
    this.snapshot.custodyBalances.push(balance);
  }

  private hasCustodyEntry(type: CustodyLedgerEntry["type"], executionJobId: string): boolean {
    return this.snapshot.custodyLedgerEntries.some((entry) =>
      entry.type === type && entry.executionJobId === executionJobId
    );
  }

  private hasCustodyCredit(source: string, externalRef: string): boolean {
    return this.snapshot.custodyLedgerEntries.some((entry) =>
      entry.type === "sweep_credit" && entry.source === source && entry.externalRef === externalRef
    );
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
