import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ControlRun,
  PortfolioBalanceSnapshot,
  WalletFundingBalance,
  WalletSpendLedgerEntry,
  ExecutionJob,
  Position,
  PositionReview,
  RunStep,
  SourcePost,
  TradeTicket,
  UserDepositAddress,
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
  positions: Position[];
  positionReviews: PositionReview[];
  portfolioBalanceSnapshots: PortfolioBalanceSnapshot[];
  walletSpendLedgerEntries: WalletSpendLedgerEntry[];
  auditEvents: AuditEvent[];
  userSettings: UserSettings[];
  controlRuns: ControlRun[];
  runSteps: RunStep[];
  modelCallUsage: ModelCallUsageRecord[];
}

export type UserDashboardData = Pick<
  CassieStoreSnapshot,
  "tradeTickets" | "executionJobs" | "positions" | "controlRuns" | "runSteps"
>;

export type UserDashboardDataOptions = {
  activityLimit: number;
};

// Cross-user slice for the public tape: recent runs with just enough
// surrounding state (tickets, positions, intake steps, trader profiles) to
// render each call and its PnL.
export type GlobalTapeData = Pick<
  CassieStoreSnapshot,
  "controlRuns" | "tradeTickets" | "positions" | "runSteps" | "userSettings"
>;

export type GlobalTapeDataOptions = {
  runLimit: number;
};

export type NewRunStep = Omit<
  RunStep,
  "stepId" | "startedAt" | "completedAt"
> & {
  completedAt?: string | null;
};

export interface CassieStore {
  load(): Promise<CassieStoreSnapshot>;
  loadUserDashboardData(
    userId: string,
    options: UserDashboardDataOptions,
  ): Promise<UserDashboardData>;
  loadGlobalTapeData(options: GlobalTapeDataOptions): Promise<GlobalTapeData>;
  upsertUserSettings(settings: UserSettings): Promise<void>;
  // Merges top-level fields into stored settings atomically. Use for
  // concurrent flag writes (introSeenAt, promoGrant) where whole-object
  // upserts from stale snapshots would clobber each other.
  patchUserSettings(
    userId: string,
    patch: Partial<UserSettings>,
  ): Promise<void>;
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  getUserSettingsByPrivyUserId(
    privyUserId: string,
  ): Promise<UserSettings | undefined>;
  getUserSettingsByXIdentity(input: {
    userId?: string | null;
    username?: string | null;
  }): Promise<UserSettings | undefined>;
  syncPrivyUser(input: {
    privyUserId: string;
    privyWalletId: string | null;
    walletAddress: string | null;
    profile: UserSettings["profile"];
    x?: UserSettings["x"];
    defaultTradeSizeUsd?: number;
  }): Promise<UserSettings>;
  syncXUser(input: {
    xUserId: string;
    username: string | null;
    profile: UserSettings["profile"];
    defaultTradeSizeUsd?: number;
  }): Promise<UserSettings>;
  getDepositAddress(userId: string): Promise<UserDepositAddress | undefined>;
  getDepositAddressByEvmAddress(
    evmAddress: string,
  ): Promise<UserDepositAddress | undefined>;
  addUserDepositAddress(
    record: UserDepositAddress,
  ): Promise<UserDepositAddress>;
  recordDepositCredit(input: {
    userId: string;
    amountUsd: number;
    chain: string | null;
    txHash: string | null;
    logIndex?: number | null;
    circleTransferId: string;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null>;
  recordSweepToGateway(input: {
    userId: string;
    amountUsd: number;
    chain: string | null;
    circleTransferId: string;
    txHash?: string | null;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null>;
  getDepositFundingBalance(userId: string): Promise<WalletFundingBalance>;
  listUserDepositCredits(
    userId: string,
    limit?: number,
  ): Promise<WalletSpendLedgerEntry[]>;
  recordRefundCredit(input: {
    userId: string;
    amountUsd: number;
    referenceId: string;
    chain?: string | null;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null>;
  recordGatewayMint(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    amountUsd: number;
    chain: string;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null>;
  createRun(input: {
    userId: string;
    userCommand: string;
    sourcePost: SourcePost;
  }): Promise<ControlRun>;
  updateRun(run: ControlRun): Promise<ControlRun>;
  claimRun(runId: string): Promise<ControlRun | null>;
  getRun(runId: string): Promise<ControlRun | undefined>;
  listUserRuns(
    userId: string,
    options?: { limit?: number },
  ): Promise<ControlRun[]>;
  addRunStep(input: NewRunStep): Promise<RunStep>;
  updateRunStep(step: RunStep): Promise<RunStep>;
  getRunSteps(runId: string): Promise<RunStep[]>;
  addMention(
    input: Omit<MentionRecord, "mentionId" | "createdAt">,
  ): Promise<MentionRecord>;
  addModelCallUsage(input: NewModelCallUsage): Promise<ModelCallUsageRecord>;
  addTradeTicket(ticket: TradeTicket): Promise<TradeTicket>;
  updateTradeTicket(ticket: TradeTicket): Promise<TradeTicket>;
  getTradeTicket(ticketId: string): Promise<TradeTicket | undefined>;
  getTradeTickets(ticketIds: string[]): Promise<TradeTicket[]>;
  addExecutionJob(job: ExecutionJob): Promise<ExecutionJob>;
  updateExecutionJob(job: ExecutionJob): Promise<ExecutionJob>;
  getExecutionJob(jobId: string): Promise<ExecutionJob | undefined>;
  addPosition(position: Position): Promise<Position>;
  updatePosition(position: Position): Promise<Position>;
  getPosition(positionId: string): Promise<Position | undefined>;
  getPositionByExecutionJob(
    executionJobId: string,
  ): Promise<Position | undefined>;
  listOpenPositions(userId?: string): Promise<Position[]>;
  listUserPositions(userId: string): Promise<Position[]>;
  addPositionReview(review: PositionReview): Promise<PositionReview>;
  getLatestPositionReview(
    positionId: string,
  ): Promise<PositionReview | undefined>;
  getLatestPositionReviews(positionIds: string[]): Promise<PositionReview[]>;
  listPositionReviews(positionId: string): Promise<PositionReview[]>;
  recordPortfolioBalanceSnapshot(
    input: Omit<PortfolioBalanceSnapshot, "snapshotId" | "at"> & {
      at?: string;
    },
  ): Promise<PortfolioBalanceSnapshot>;
  listPortfolioBalanceSnapshots(
    userId: string,
    limit: number,
  ): Promise<PortfolioBalanceSnapshot[]>;
  getWalletFundingBalance(
    userId: string,
    walletBalanceUsd: number,
  ): Promise<WalletFundingBalance>;
  reserveWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    walletBalanceUsd: number;
  }): Promise<WalletFundingBalance>;
  releaseWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    reason: string;
    walletBalanceUsd: number;
    metadata?: unknown;
  }): Promise<WalletFundingBalance>;
  recordWalletPrefund(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    amountUsd: number;
    metadata: unknown;
    walletBalanceUsd: number;
  }): Promise<WalletFundingBalance>;
  settleWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    executionResult: NonNullable<ExecutionJob["executionResult"]>;
    walletBalanceUsd: number;
    releaseMetadata?: unknown;
  }): Promise<WalletFundingBalance>;
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
  positions: [],
  positionReviews: [],
  portfolioBalanceSnapshots: [],
  walletSpendLedgerEntries: [],
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

  async loadUserDashboardData(
    userId: string,
    options: UserDashboardDataOptions,
  ): Promise<UserDashboardData> {
    const positions = this.snapshot.positions.filter(
      (position) => position.userId === userId,
    );
    const ticketIds = new Set(positions.map((position) => position.ticketId));
    const tickets = this.snapshot.tradeTickets.filter(
      (ticket) => ticket.userId === userId || ticketIds.has(ticket.ticketId),
    );
    const executionJobIds = new Set(
      positions.map((position) => position.executionJobId),
    );
    const controlRuns = this.snapshot.controlRuns
      .filter((run) => run.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, options.activityLimit);
    const runIds = new Set(controlRuns.map((run) => run.runId));
    return {
      tradeTickets: tickets,
      executionJobs: this.snapshot.executionJobs.filter((job) =>
        executionJobIds.has(job.jobId),
      ),
      positions,
      controlRuns,
      runSteps: this.snapshot.runSteps.filter((step) => runIds.has(step.runId)),
    };
  }

  async loadGlobalTapeData(
    options: GlobalTapeDataOptions,
  ): Promise<GlobalTapeData> {
    const controlRuns = this.snapshot.controlRuns
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, options.runLimit);
    const runIds = new Set(controlRuns.map((run) => run.runId));
    const userIds = new Set(controlRuns.map((run) => run.userId));
    const tickets = this.snapshot.tradeTickets.filter(
      (ticket) => ticket.runId && runIds.has(ticket.runId),
    );
    const ticketIds = new Set(tickets.map((ticket) => ticket.ticketId));
    return {
      controlRuns,
      tradeTickets: tickets,
      positions: this.snapshot.positions.filter((position) =>
        ticketIds.has(position.ticketId),
      ),
      // Only intake steps: the tape just needs the watch/countertrade intent.
      runSteps: this.snapshot.runSteps.filter(
        (step) => runIds.has(step.runId) && step.stepType === "intake",
      ),
      userSettings: this.snapshot.userSettings.filter((settings) =>
        userIds.has(settings.userId),
      ),
    };
  }

  async upsertUserSettings(settings: UserSettings): Promise<void> {
    this.snapshot.userSettings = this.snapshot.userSettings.filter(
      (candidate) => candidate.userId !== settings.userId,
    );
    this.snapshot.userSettings.push(settings);
  }

  async patchUserSettings(
    userId: string,
    patch: Partial<UserSettings>,
  ): Promise<void> {
    const existing = await this.getUserSettings(userId);
    if (!existing) {
      throw new Error(`No settings to patch for user ${userId}.`);
    }
    await this.upsertUserSettings({ ...existing, ...patch });
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    return this.snapshot.userSettings.find(
      (settings) => settings.userId === userId,
    );
  }

  async getUserSettingsByPrivyUserId(
    privyUserId: string,
  ): Promise<UserSettings | undefined> {
    return this.snapshot.userSettings.find(
      (settings) => settings.privyUserId === privyUserId,
    );
  }

  async getUserSettingsByXIdentity(input: {
    userId?: string | null;
    username?: string | null;
  }): Promise<UserSettings | undefined> {
    const username = normalizeXUsername(input.username);
    return this.snapshot.userSettings.find(
      (settings) =>
        (input.userId && settings.x?.userId === input.userId) ||
        (username && normalizeXUsername(settings.x?.username) === username) ||
        (username && normalizeXUsername(settings.profile.handle) === username),
    );
  }

  async syncPrivyUser(input: {
    privyUserId: string;
    privyWalletId: string | null;
    walletAddress: string | null;
    profile: UserSettings["profile"];
    x?: UserSettings["x"];
    defaultTradeSizeUsd?: number;
  }): Promise<UserSettings> {
    const existing = await this.getUserSettingsByPrivyUserId(input.privyUserId);
    const settings: UserSettings = {
      userId: existing?.userId ?? input.privyUserId,
      privyUserId: input.privyUserId,
      privyWalletId: input.privyWalletId,
      walletAddress: input.walletAddress,
      profile: input.profile,
      x: input.x ?? existing?.x ?? null,
      defaultTradeSizeUsd:
        input.defaultTradeSizeUsd ?? existing?.defaultTradeSizeUsd ?? 5,
      telegram: existing?.telegram ?? null,
      introSeenAt: existing?.introSeenAt ?? null,
      promoGrant: existing?.promoGrant ?? null,
    };
    await this.upsertUserSettings(settings);
    return settings;
  }

  async syncXUser(input: {
    xUserId: string;
    username: string | null;
    profile: UserSettings["profile"];
    defaultTradeSizeUsd?: number;
  }): Promise<UserSettings> {
    const existing = await this.getUserSettingsByXIdentity({
      userId: input.xUserId,
      username: input.username,
    });
    const settings: UserSettings = {
      userId: existing?.userId ?? `x:${input.xUserId}`,
      privyUserId: existing?.privyUserId ?? null,
      privyWalletId: existing?.privyWalletId ?? null,
      walletAddress: existing?.walletAddress ?? null,
      profile: input.profile,
      x: { userId: input.xUserId, username: input.username },
      defaultTradeSizeUsd:
        input.defaultTradeSizeUsd ?? existing?.defaultTradeSizeUsd ?? 5,
      telegram: existing?.telegram ?? null,
      introSeenAt: existing?.introSeenAt ?? null,
      promoGrant: existing?.promoGrant ?? null,
    };
    await this.upsertUserSettings(settings);
    return settings;
  }

  private depositAddresses: UserDepositAddress[] = [];

  async getDepositAddress(userId: string): Promise<UserDepositAddress | undefined> {
    return this.depositAddresses.find((record) => record.userId === userId);
  }

  async getDepositAddressByEvmAddress(
    evmAddress: string,
  ): Promise<UserDepositAddress | undefined> {
    const normalized = evmAddress.toLowerCase();
    return this.depositAddresses.find(
      (record) => record.evmAddress.toLowerCase() === normalized,
    );
  }

  async addUserDepositAddress(
    record: UserDepositAddress,
  ): Promise<UserDepositAddress> {
    const existing = await this.getDepositAddress(record.userId);
    if (existing) return existing;
    this.depositAddresses.push(record);
    return record;
  }

  async recordDepositCredit(input: {
    userId: string;
    amountUsd: number;
    chain: string | null;
    txHash: string | null;
    logIndex?: number | null;
    circleTransferId: string;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null> {
    if (this.hasDepositLedgerEntry("deposit_credit", input)) return null;
    const entry: WalletSpendLedgerEntry = {
      entryId: randomUUID(),
      userId: input.userId,
      type: "deposit_credit",
      amountUsd: centsToUsd(positiveUsdToCents(input.amountUsd)),
      ticketId: null,
      executionJobId: null,
      chain: input.chain,
      txHash: input.txHash,
      logIndex: input.logIndex ?? null,
      circleTransferId: input.circleTransferId,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.walletSpendLedgerEntries.push(entry);
    return entry;
  }

  async recordSweepToGateway(input: {
    userId: string;
    amountUsd: number;
    chain: string | null;
    circleTransferId: string;
    txHash?: string | null;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null> {
    if (this.hasDepositLedgerEntry("sweep_to_gateway", input)) return null;
    const entry: WalletSpendLedgerEntry = {
      entryId: randomUUID(),
      userId: input.userId,
      type: "sweep_to_gateway",
      amountUsd: centsToUsd(positiveUsdToCents(input.amountUsd)),
      ticketId: null,
      executionJobId: null,
      chain: input.chain,
      txHash: input.txHash ?? null,
      logIndex: null,
      circleTransferId: input.circleTransferId,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.walletSpendLedgerEntries.push(entry);
    return entry;
  }

  async getDepositFundingBalance(userId: string): Promise<WalletFundingBalance> {
    return walletFundingBalance({
      userId,
      walletBalanceUsdCents: this.internalBalanceUsdCents(userId),
      reservedUsdCents: this.openReservedUsdCents(userId),
      updatedAt: new Date().toISOString(),
    });
  }

  async listUserDepositCredits(
    userId: string,
    limit = 25,
  ): Promise<WalletSpendLedgerEntry[]> {
    return this.snapshot.walletSpendLedgerEntries
      .filter((entry) => entry.userId === userId && entry.type === "deposit_credit")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async recordRefundCredit(input: {
    userId: string;
    amountUsd: number;
    referenceId: string;
    chain?: string | null;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null> {
    const dedupe = {
      chain: input.chain ?? null,
      txHash: null,
      circleTransferId: input.referenceId,
    };
    if (this.hasDepositLedgerEntry("refund_credit", dedupe)) return null;
    const entry: WalletSpendLedgerEntry = {
      entryId: randomUUID(),
      userId: input.userId,
      type: "refund_credit",
      amountUsd: centsToUsd(positiveUsdToCents(input.amountUsd)),
      ticketId: null,
      executionJobId: null,
      chain: input.chain ?? null,
      txHash: null,
      logIndex: null,
      circleTransferId: input.referenceId,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.walletSpendLedgerEntries.push(entry);
    return entry;
  }

  async recordGatewayMint(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    amountUsd: number;
    chain: string;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null> {
    if (this.hasWalletSpendEntry("gateway_mint", input.job.jobId)) return null;
    const entry: WalletSpendLedgerEntry = {
      entryId: randomUUID(),
      userId: input.ticket.userId,
      type: "gateway_mint",
      amountUsd: centsToUsd(positiveUsdToCents(input.amountUsd)),
      ticketId: input.ticket.ticketId,
      executionJobId: input.job.jobId,
      chain: input.chain,
      txHash: null,
      logIndex: null,
      circleTransferId: null,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.walletSpendLedgerEntries.push(entry);
    return entry;
  }

  private hasDepositLedgerEntry(
    type: WalletSpendLedgerEntry["type"],
    input: {
      chain: string | null;
      txHash?: string | null;
      logIndex?: number | null;
      circleTransferId: string;
    },
  ): boolean {
    return this.snapshot.walletSpendLedgerEntries.some((entry) => {
      if (entry.type !== type) return false;
      if (entry.circleTransferId === input.circleTransferId) return true;
      return Boolean(
        input.txHash
          && entry.txHash === input.txHash
          && entry.chain === input.chain
          && (entry.logIndex ?? 0) === (input.logIndex ?? 0),
      );
    });
  }

  // Credited funds = deposits + refunds - settled spends. Reservations are
  // handled separately (openReservedUsdCents); prefund/release/mint entries
  // track physical money movement, not the user's credited balance.
  private internalBalanceUsdCents(userId: string): number {
    return this.snapshot.walletSpendLedgerEntries.reduce((total, entry) => {
      if (entry.userId !== userId) return total;
      const cents = usdToCents(entry.amountUsd);
      if (entry.type === "deposit_credit" || entry.type === "refund_credit") {
        return total + cents;
      }
      if (entry.type === "trade_spend") return total - cents;
      return total;
    }, 0);
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

  async claimRun(runId: string): Promise<ControlRun | null> {
    const run = this.snapshot.controlRuns.find(
      (candidate) => candidate.runId === runId,
    );
    if (!run || run.status !== "queued") return null;
    const claimed: ControlRun = {
      ...run,
      status: "running",
      error: null,
      updatedAt: new Date().toISOString(),
    };
    await this.updateRun(claimed);
    return claimed;
  }

  async getRun(runId: string): Promise<ControlRun | undefined> {
    return this.snapshot.controlRuns.find((run) => run.runId === runId);
  }

  async listUserRuns(
    userId: string,
    options: { limit?: number } = {},
  ): Promise<ControlRun[]> {
    return this.snapshot.controlRuns
      .filter((run) => run.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, options.limit ?? 20);
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

  async addMention(
    input: Omit<MentionRecord, "mentionId" | "createdAt">,
  ): Promise<MentionRecord> {
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

  async addModelCallUsage(
    input: NewModelCallUsage,
  ): Promise<ModelCallUsageRecord> {
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
    return this.snapshot.tradeTickets.find(
      (ticket) => ticket.ticketId === ticketId,
    );
  }

  async getTradeTickets(ticketIds: string[]): Promise<TradeTicket[]> {
    const ids = new Set(ticketIds);
    return this.snapshot.tradeTickets.filter((ticket) =>
      ids.has(ticket.ticketId),
    );
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
    this.snapshot.executionJobs = this.snapshot.executionJobs.map(
      (candidate) => (candidate.jobId === job.jobId ? job : candidate),
    );
    return job;
  }

  async getExecutionJob(jobId: string): Promise<ExecutionJob | undefined> {
    return this.snapshot.executionJobs.find((job) => job.jobId === jobId);
  }

  async addPosition(position: Position): Promise<Position> {
    this.snapshot.positions.push(position);
    await this.audit({
      entityId: position.positionId,
      entityType: "position",
      eventType: "position.created",
      message: "Position created.",
      data: position,
    });
    return position;
  }

  async updatePosition(position: Position): Promise<Position> {
    this.snapshot.positions = this.snapshot.positions.map((candidate) =>
      candidate.positionId === position.positionId ? position : candidate,
    );
    return position;
  }

  async getPosition(positionId: string): Promise<Position | undefined> {
    return this.snapshot.positions.find(
      (position) => position.positionId === positionId,
    );
  }

  async getPositionByExecutionJob(
    executionJobId: string,
  ): Promise<Position | undefined> {
    return this.snapshot.positions.find(
      (position) => position.executionJobId === executionJobId,
    );
  }

  async listOpenPositions(userId?: string): Promise<Position[]> {
    return this.snapshot.positions.filter(
      (position) =>
        position.status === "open" && (!userId || position.userId === userId),
    );
  }

  async listUserPositions(userId: string): Promise<Position[]> {
    return this.snapshot.positions.filter(
      (position) => position.userId === userId,
    );
  }

  async addPositionReview(review: PositionReview): Promise<PositionReview> {
    this.snapshot.positionReviews.push(review);
    return review;
  }

  async getLatestPositionReview(
    positionId: string,
  ): Promise<PositionReview | undefined> {
    return this.snapshot.positionReviews
      .filter((review) => review.positionId === positionId)
      .sort((left, right) =>
        right.reviewedAt.localeCompare(left.reviewedAt),
      )[0];
  }

  async getLatestPositionReviews(
    positionIds: string[],
  ): Promise<PositionReview[]> {
    const ids = new Set(positionIds);
    const latest = new Map<string, PositionReview>();
    for (const review of this.snapshot.positionReviews) {
      if (!ids.has(review.positionId)) continue;
      const current = latest.get(review.positionId);
      if (!current || review.reviewedAt > current.reviewedAt) {
        latest.set(review.positionId, review);
      }
    }
    return [...latest.values()];
  }

  async listPositionReviews(positionId: string): Promise<PositionReview[]> {
    return this.snapshot.positionReviews
      .filter((review) => review.positionId === positionId)
      .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
  }

  async recordPortfolioBalanceSnapshot(
    input: Omit<PortfolioBalanceSnapshot, "snapshotId" | "at"> & {
      at?: string;
    },
  ): Promise<PortfolioBalanceSnapshot> {
    const latest = this.snapshot.portfolioBalanceSnapshots
      .filter((snapshot) => snapshot.userId === input.userId)
      .at(-1);
    if (latest && samePortfolioBalanceSnapshot(latest, input)) return latest;

    const snapshot: PortfolioBalanceSnapshot = {
      snapshotId: randomUUID(),
      userId: input.userId,
      at: monotonicSnapshotAt(input.at ?? new Date().toISOString(), latest?.at),
      valueUsd: roundUsd(input.valueUsd),
      walletBalanceUsd: roundUsd(input.walletBalanceUsd),
      unrealizedPnlUsd: roundUsd(input.unrealizedPnlUsd),
    };
    this.snapshot.portfolioBalanceSnapshots.push(snapshot);
    return snapshot;
  }

  async listPortfolioBalanceSnapshots(
    userId: string,
    limit: number,
  ): Promise<PortfolioBalanceSnapshot[]> {
    return this.snapshot.portfolioBalanceSnapshots
      .filter((snapshot) => snapshot.userId === userId)
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, limit)
      .sort((left, right) => left.at.localeCompare(right.at));
  }

  async getWalletFundingBalance(
    userId: string,
    walletBalanceUsd: number,
  ): Promise<WalletFundingBalance> {
    return walletFundingBalance({
      userId,
      walletBalanceUsdCents: nonnegativeUsdToCents(walletBalanceUsd),
      reservedUsdCents: this.openReservedUsdCents(userId),
      updatedAt: new Date().toISOString(),
    });
  }

  async reserveWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    walletBalanceUsd: number;
  }): Promise<WalletFundingBalance> {
    const ticketSizeCents = positiveUsdToCents(input.ticket.sizeUsd);
    if (this.hasWalletSpendEntry("trade_reserve", input.job.jobId)) {
      return this.getWalletFundingBalance(
        input.ticket.userId,
        input.walletBalanceUsd,
      );
    }

    const walletBalanceUsdCents = nonnegativeUsdToCents(input.walletBalanceUsd);
    const reservedUsdCents = this.openReservedUsdCents(input.ticket.userId);
    if (walletBalanceUsdCents - reservedUsdCents < ticketSizeCents) {
      throw new Error("Insufficient user wallet balance.");
    }

    this.snapshot.walletSpendLedgerEntries.push(
      walletSpendLedgerEntry({
        userId: input.ticket.userId,
        type: "trade_reserve",
        amountUsd: centsToUsd(ticketSizeCents),
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        metadata: {
          venue: input.ticket.venue,
          instrument: input.ticket.instrument,
          side: input.ticket.side,
        },
        createdAt: new Date().toISOString(),
      }),
    );
    return walletFundingBalance({
      userId: input.ticket.userId,
      walletBalanceUsdCents,
      reservedUsdCents: reservedUsdCents + ticketSizeCents,
      updatedAt: new Date().toISOString(),
    });
  }

  async releaseWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    reason: string;
    walletBalanceUsd: number;
    metadata?: unknown;
  }): Promise<WalletFundingBalance> {
    const ticketSizeCents = positiveUsdToCents(input.ticket.sizeUsd);
    if (this.hasWalletSpendEntry("trade_release", input.job.jobId)) {
      return this.getWalletFundingBalance(
        input.ticket.userId,
        input.walletBalanceUsd,
      );
    }

    const walletBalanceUsdCents = nonnegativeUsdToCents(input.walletBalanceUsd);
    const reservedUsdCents = this.openReservedUsdCents(input.ticket.userId);
    if (reservedUsdCents < ticketSizeCents) {
      throw new Error("Cannot release a missing trade reservation.");
    }

    this.snapshot.walletSpendLedgerEntries.push(
      walletSpendLedgerEntry({
        userId: input.ticket.userId,
        type: "trade_release",
        amountUsd: centsToUsd(ticketSizeCents),
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        metadata: input.metadata ?? { reason: input.reason },
        createdAt: new Date().toISOString(),
      }),
    );
    return walletFundingBalance({
      userId: input.ticket.userId,
      walletBalanceUsdCents,
      reservedUsdCents: reservedUsdCents - ticketSizeCents,
      updatedAt: new Date().toISOString(),
    });
  }

  async recordWalletPrefund(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    amountUsd: number;
    metadata: unknown;
    walletBalanceUsd: number;
  }): Promise<WalletFundingBalance> {
    const prefundCents = positiveUsdToCents(input.amountUsd);
    if (this.hasWalletSpendEntry("trade_prefund", input.job.jobId)) {
      return this.getWalletFundingBalance(
        input.ticket.userId,
        input.walletBalanceUsd,
      );
    }

    this.snapshot.walletSpendLedgerEntries.push(
      walletSpendLedgerEntry({
        userId: input.ticket.userId,
        type: "trade_prefund",
        amountUsd: centsToUsd(prefundCents),
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        metadata: input.metadata,
        createdAt: new Date().toISOString(),
      }),
    );
    return this.getWalletFundingBalance(
      input.ticket.userId,
      input.walletBalanceUsd,
    );
  }

  async settleWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    executionResult: NonNullable<ExecutionJob["executionResult"]>;
    walletBalanceUsd: number;
    releaseMetadata?: unknown;
  }): Promise<WalletFundingBalance> {
    const ticketSizeCents = positiveUsdToCents(input.ticket.sizeUsd);
    if (this.hasWalletSpendEntry("trade_spend", input.job.jobId)) {
      return this.getWalletFundingBalance(
        input.ticket.userId,
        input.walletBalanceUsd,
      );
    }

    const filledSizeCents = normalizedFilledSizeCents(
      input.ticket,
      input.executionResult,
    );
    const releaseCents = ticketSizeCents - filledSizeCents;
    const walletBalanceUsdCents = nonnegativeUsdToCents(input.walletBalanceUsd);
    const reservedUsdCents = this.openReservedUsdCents(input.ticket.userId);
    if (reservedUsdCents < ticketSizeCents) {
      throw new Error("Cannot settle a missing trade reservation.");
    }

    const now = new Date().toISOString();
    this.snapshot.walletSpendLedgerEntries.push(
      walletSpendLedgerEntry({
        userId: input.ticket.userId,
        type: "trade_spend",
        amountUsd: centsToUsd(filledSizeCents),
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        metadata: input.executionResult,
        createdAt: now,
      }),
    );
    if (releaseCents > 0) {
      this.snapshot.walletSpendLedgerEntries.push(
        walletSpendLedgerEntry({
          userId: input.ticket.userId,
          type: "trade_release",
          amountUsd: centsToUsd(releaseCents),
          ticketId: input.ticket.ticketId,
          executionJobId: input.job.jobId,
          metadata: input.releaseMetadata ?? {
            reason: "unfilled_order_amount",
          },
          createdAt: now,
        }),
      );
    }
    return walletFundingBalance({
      userId: input.ticket.userId,
      walletBalanceUsdCents,
      reservedUsdCents: reservedUsdCents - ticketSizeCents,
      updatedAt: new Date().toISOString(),
    });
  }

  async listTradeTicketsWithoutExecutionJob(
    runId: string,
  ): Promise<TradeTicket[]> {
    const existingExecutionTicketIds = new Set(
      this.snapshot.executionJobs.map((job) => job.ticketId),
    );
    return this.snapshot.tradeTickets.filter(
      (ticket) =>
        ticket.runId === runId &&
        !existingExecutionTicketIds.has(ticket.ticketId),
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

  async audit(
    input: Omit<AuditEvent, "eventId" | "createdAt">,
  ): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      eventId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.snapshot.auditEvents.push(event);
    return event;
  }

  private hasWalletSpendEntry(
    type: WalletSpendLedgerEntry["type"],
    executionJobId: string,
  ): boolean {
    return this.snapshot.walletSpendLedgerEntries.some(
      (entry) => entry.type === type && entry.executionJobId === executionJobId,
    );
  }

  private openReservedUsdCents(userId: string): number {
    return this.snapshot.walletSpendLedgerEntries.reduce((total, entry) => {
      if (entry.userId !== userId) return total;
      if (entry.type === "trade_reserve")
        return total + nonnegativeUsdToCents(entry.amountUsd);
      if (entry.type === "trade_release" || entry.type === "trade_spend") {
        return total - nonnegativeUsdToCents(entry.amountUsd);
      }
      return total;
    }, 0);
  }
}

function normalizeXUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized ? normalized : null;
}

function positiveUsdToCents(amountUsd: number): number {
  if (!Number.isFinite(amountUsd)) {
    throw new Error("Wallet spend amount must be a positive USD value.");
  }
  const cents = usdToCents(amountUsd);
  if (cents <= 0) {
    throw new Error("Wallet spend amount must be a positive USD value.");
  }
  return cents;
}

function nonnegativeUsdToCents(amountUsd: number): number {
  if (!Number.isFinite(amountUsd)) {
    throw new Error("Wallet balance must be a nonnegative USD value.");
  }
  const cents = usdToCents(amountUsd);
  if (cents < 0) {
    throw new Error("Wallet balance must be a nonnegative USD value.");
  }
  return cents;
}

function usdToCents(amountUsd: number): number {
  return Math.round(amountUsd * 100);
}

function centsToUsd(amountUsdCents: number): number {
  return amountUsdCents / 100;
}

function roundUsd(amountUsd: number): number {
  return centsToUsd(usdToCents(amountUsd));
}

function samePortfolioBalanceSnapshot(
  left: Pick<
    PortfolioBalanceSnapshot,
    "valueUsd" | "walletBalanceUsd" | "unrealizedPnlUsd"
  >,
  right: Pick<
    PortfolioBalanceSnapshot,
    "valueUsd" | "walletBalanceUsd" | "unrealizedPnlUsd"
  >,
): boolean {
  return (
    usdToCents(left.valueUsd) === usdToCents(right.valueUsd) &&
    usdToCents(left.walletBalanceUsd) === usdToCents(right.walletBalanceUsd) &&
    usdToCents(left.unrealizedPnlUsd) === usdToCents(right.unrealizedPnlUsd)
  );
}

function monotonicSnapshotAt(
  at: string,
  previousAt: string | undefined,
): string {
  if (!previousAt || at > previousAt) return at;
  return new Date(Date.parse(previousAt) + 1).toISOString();
}

function normalizedFilledSizeCents(
  ticket: TradeTicket,
  executionResult: NonNullable<ExecutionJob["executionResult"]>,
): number {
  if (
    !Number.isFinite(executionResult.filledSizeUsd) ||
    executionResult.filledSizeUsd < 0
  ) {
    throw new Error("Execution result filledSizeUsd must be nonnegative.");
  }
  const filledSizeCents = usdToCents(
    executionResult.collateralUsedUsd ?? executionResult.filledSizeUsd,
  );
  if (filledSizeCents > positiveUsdToCents(ticket.sizeUsd)) {
    throw new Error(
      "Execution result used more collateral than the reserved ticket size.",
    );
  }
  return filledSizeCents;
}

function walletFundingBalance(input: {
  userId: string;
  walletBalanceUsdCents: number;
  reservedUsdCents: number;
  updatedAt: string;
}): WalletFundingBalance {
  const spendableUsdCents =
    input.walletBalanceUsdCents - input.reservedUsdCents;
  return {
    userId: input.userId,
    walletBalanceUsd: centsToUsd(input.walletBalanceUsdCents),
    reservedUsd: centsToUsd(input.reservedUsdCents),
    spendableUsd: centsToUsd(spendableUsdCents > 0 ? spendableUsdCents : 0),
    updatedAt: input.updatedAt,
  };
}

function walletSpendLedgerEntry(
  input: Omit<WalletSpendLedgerEntry, "entryId">,
): WalletSpendLedgerEntry {
  return {
    ...input,
    entryId: randomUUID(),
  };
}
