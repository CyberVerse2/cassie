import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ControlRun,
  ExecutionJob,
  PortfolioBalanceSnapshot,
  Position,
  PositionReview,
  RunStep,
  SourcePost,
  TradeTicket,
  UserDepositAddress,
  UserSettings,
  WalletFundingBalance,
  WalletSpendLedgerEntry,
} from "../schemas/index.ts";
import {
  auditEvents,
  controlRuns,
  executionJobs,
  mentions,
  positionReviews,
  positions,
  portfolioBalanceSnapshots,
  runtimeState,
  runSteps,
  tradeTickets,
  modelCallUsage,
  userDepositAddresses,
  userSettings,
  walletSpendLedgerEntries,
} from "./schema.ts";
import { createCassieDb, type CassieDb } from "./client.ts";
import type {
  CassieStore,
  CassieStoreSnapshot,
  GlobalTapeData,
  GlobalTapeDataOptions,
  MentionRecord,
  NewModelCallUsage,
  NewRunStep,
  UserDashboardData,
  UserDashboardDataOptions,
} from "./store.ts";

export class DrizzleCassieStore implements CassieStore {
  constructor(private readonly db: CassieDb = createCassieDb()) {}

  async load(): Promise<CassieStoreSnapshot> {
    const [
      userSettingsRows,
      mentionRows,
      ticketRows,
      jobRows,
      positionRows,
      reviewRows,
      portfolioBalanceRows,
      auditRows,
      walletSpendLedgerRows,
      controlRunRows,
      stepRows,
      modelCallUsageRows,
    ] = await Promise.all([
      this.db.select().from(userSettings),
      this.db.select().from(mentions),
      this.db.select().from(tradeTickets),
      this.db.select().from(executionJobs),
      this.db.select().from(positions),
      this.db.select().from(positionReviews),
      this.db.select().from(portfolioBalanceSnapshots),
      this.db.select().from(auditEvents),
      this.db.select().from(walletSpendLedgerEntries),
      this.db.select().from(controlRuns),
      this.db.select().from(runSteps),
      this.db.select().from(modelCallUsage),
    ]);

    return {
      userSettings: userSettingsRows.map((row) => row.settings),
      mentions: mentionRows,
      tradeTickets: ticketRows.map((row) => row.ticket),
      executionJobs: jobRows.map((row) => row.job),
      positions: positionRows.map((row) => row.position),
      positionReviews: reviewRows.map((row) => row.review),
      portfolioBalanceSnapshots: portfolioBalanceRows.map(
        (row) => row.snapshot,
      ),
      walletSpendLedgerEntries: walletSpendLedgerRows.map((row) => ({
        entryId: row.entryId,
        userId: row.userId,
        type: row.type,
        amountUsd: centsToUsd(row.amountUsdCents),
        ticketId: row.ticketId ?? null,
        executionJobId: row.executionJobId ?? null,
        chain: row.chain ?? null,
        txHash: row.txHash ?? null,
        logIndex: row.logIndex ?? null,
        circleTransferId: row.circleTransferId ?? null,
        metadata: row.metadata ?? null,
        createdAt: row.createdAt,
      })),
      auditEvents: auditRows.map((row) => ({
        ...row,
        data: row.data ?? undefined,
      })),
      controlRuns: controlRunRows.map((row) => ({
        ...row,
        result: row.result ?? null,
      })),
      runSteps: stepRows.map((row) => ({
        ...row,
        input: row.input ?? null,
        output: row.output ?? null,
        thinkingTrace: row.thinkingTrace ?? null,
      })),
      modelCallUsage: modelCallUsageRows.map((row) => ({
        ...row,
        runStepId: row.runStepId ?? null,
        promptName: row.promptName ?? null,
        promptVersion: row.promptVersion ?? null,
        inputTokens: row.inputTokens ?? null,
        outputTokens: row.outputTokens ?? null,
        reasoningTokens: row.reasoningTokens ?? null,
        cachedTokens: row.cachedTokens ?? null,
        totalTokens: row.totalTokens ?? null,
        estimatedCostUsd: row.estimatedCostUsd ?? null,
        latencyMs: row.latencyMs ?? null,
        thinkingTrace: row.thinkingTrace ?? null,
        error: row.error ?? null,
      })),
    };
  }

  async loadUserDashboardData(
    userId: string,
    options: UserDashboardDataOptions,
  ): Promise<UserDashboardData> {
    const [positionRows, ticketRows, controlRunRows] = await Promise.all([
      this.db
        .select()
        .from(positions)
        .where(eq(positions.userId, userId))
        .orderBy(desc(positions.openedAt)),
      this.db
        .select()
        .from(tradeTickets)
        .where(eq(tradeTickets.userId, userId)),
      this.db
        .select()
        .from(controlRuns)
        .where(eq(controlRuns.userId, userId))
        .orderBy(desc(controlRuns.createdAt))
        .limit(options.activityLimit),
    ]);
    const userPositions = positionRows.map((row) => row.position);
    const executionJobIds = [
      ...new Set(userPositions.map((position) => position.executionJobId)),
    ];
    const runIds = controlRunRows.map((row) => row.runId);
    const [jobRows, stepRows] = await Promise.all([
      executionJobIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(executionJobs)
            .where(inArray(executionJobs.jobId, executionJobIds)),
      runIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(runSteps)
            .where(inArray(runSteps.runId, runIds)),
    ]);

    return {
      tradeTickets: ticketRows.map((row) => row.ticket),
      executionJobs: jobRows.map((row) => row.job),
      positions: userPositions,
      controlRuns: controlRunRows.map((row) => ({
        ...row,
        result: row.result ?? null,
      })),
      runSteps: stepRows.map((row) => ({
        ...row,
        input: row.input ?? null,
        output: row.output ?? null,
        thinkingTrace: row.thinkingTrace ?? null,
      })),
    };
  }

  async loadGlobalTapeData(
    options: GlobalTapeDataOptions,
  ): Promise<GlobalTapeData> {
    const controlRunRows = await this.db
      .select()
      .from(controlRuns)
      .orderBy(desc(controlRuns.createdAt))
      .limit(options.runLimit);
    const runIds = controlRunRows.map((row) => row.runId);
    const userIds = [...new Set(controlRunRows.map((row) => row.userId))];
    const [ticketRows, stepRows, settingsRows] = await Promise.all([
      runIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(tradeTickets)
            .where(inArray(tradeTickets.runId, runIds)),
      // Only intake steps: the tape just needs the watch/countertrade intent,
      // and full step rows drag heavy thinking traces along.
      runIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(runSteps)
            .where(
              and(
                inArray(runSteps.runId, runIds),
                eq(runSteps.stepType, "intake"),
              ),
            ),
      userIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(userSettings)
            .where(inArray(userSettings.userId, userIds)),
    ]);
    const ticketIds = ticketRows.map((row) => row.ticketId);
    const positionRows =
      ticketIds.length === 0
        ? []
        : await this.db
            .select()
            .from(positions)
            .where(inArray(positions.ticketId, ticketIds));

    return {
      controlRuns: controlRunRows.map((row) => ({
        ...row,
        result: row.result ?? null,
      })),
      tradeTickets: ticketRows.map((row) => row.ticket),
      positions: positionRows.map((row) => row.position),
      runSteps: stepRows.map((row) => ({
        ...row,
        input: row.input ?? null,
        output: row.output ?? null,
        thinkingTrace: row.thinkingTrace ?? null,
      })),
      userSettings: settingsRows.map((row) => row.settings),
    };
  }

  async upsertUserSettings(settings: UserSettings): Promise<void> {
    await this.db
      .insert(userSettings)
      .values({
        userId: settings.userId,
        privyUserId: settings.privyUserId ?? null,
        privyWalletId: settings.privyWalletId ?? null,
        walletAddress: settings.walletAddress,
        settings,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          privyUserId: settings.privyUserId ?? null,
          privyWalletId: settings.privyWalletId ?? null,
          walletAddress: settings.walletAddress,
          settings,
          updatedAt: new Date().toISOString(),
        },
      });
  }

  async patchUserSettings(
    userId: string,
    patch: Partial<UserSettings>,
  ): Promise<void> {
    // Postgres jsonb || merges top-level keys in one statement, so two
    // concurrent patches (or a patch racing a slow multi-write flow like the
    // promo claim) can't clobber each other's fields.
    const updated = await this.db
      .update(userSettings)
      .set({
        settings: sql`${userSettings.settings} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userSettings.userId, userId))
      .returning({ userId: userSettings.userId });
    if (updated.length === 0) {
      throw new Error(`No settings to patch for user ${userId}.`);
    }
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const rows = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    return rows[0]?.settings;
  }

  async getUserSettingsByPrivyUserId(
    privyUserId: string,
  ): Promise<UserSettings | undefined> {
    const rows = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.privyUserId, privyUserId))
      .limit(1);

    return rows[0]?.settings;
  }

  async getUserSettingsByXIdentity(input: {
    userId?: string | null;
    username?: string | null;
  }): Promise<UserSettings | undefined> {
    // Fast path for the common case (every authenticated request): a targeted
    // jsonb lookup by X user id instead of scanning every user row.
    if (input.userId) {
      const byId = await this.db
        .select()
        .from(userSettings)
        .where(sql`${userSettings.settings}->'x'->>'userId' = ${input.userId}`)
        .limit(1);
      if (byId[0]) return byId[0].settings;
    }
    const username = normalizeXUsername(input.username);
    if (!username) return undefined;
    const rows = await this.db.select().from(userSettings);
    return rows
      .map((row) => row.settings)
      .find(
        (settings) =>
          (input.userId && settings.x?.userId === input.userId) ||
          (username && normalizeXUsername(settings.x?.username) === username) ||
          (username &&
            normalizeXUsername(settings.profile.handle) === username),
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

  async getDepositAddress(userId: string): Promise<UserDepositAddress | undefined> {
    const rows = await this.db
      .select()
      .from(userDepositAddresses)
      .where(eq(userDepositAddresses.userId, userId))
      .limit(1);
    return rows[0];
  }

  async getDepositAddressByEvmAddress(
    evmAddress: string,
  ): Promise<UserDepositAddress | undefined> {
    const rows = await this.db
      .select()
      .from(userDepositAddresses)
      .where(sql`lower(${userDepositAddresses.evmAddress}) = lower(${evmAddress})`)
      .limit(1);
    return rows[0];
  }

  async addUserDepositAddress(
    record: UserDepositAddress,
  ): Promise<UserDepositAddress> {
    await this.db
      .insert(userDepositAddresses)
      .values(record)
      .onConflictDoNothing({ target: userDepositAddresses.userId });
    const stored = await this.getDepositAddress(record.userId);
    if (!stored) {
      throw new Error(`Deposit address for ${record.userId} was not persisted.`);
    }
    return stored;
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
    return this.recordDepositLedgerEntry("deposit_credit", input);
  }

  async recordSweepToGateway(input: {
    userId: string;
    amountUsd: number;
    chain: string | null;
    circleTransferId: string;
    txHash?: string | null;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null> {
    return this.recordDepositLedgerEntry("sweep_to_gateway", {
      ...input,
      txHash: input.txHash ?? null,
    });
  }

  async getDepositFundingBalance(userId: string): Promise<WalletFundingBalance> {
    return walletFundingBalance({
      userId,
      walletBalanceUsdCents: await this.internalBalanceUsdCents(userId),
      reservedUsdCents: await this.openReservedUsdCents(userId),
      updatedAt: new Date().toISOString(),
    });
  }

  async listUserDepositCredits(
    userId: string,
    limit = 25,
  ): Promise<WalletSpendLedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(walletSpendLedgerEntries)
      .where(and(
        eq(walletSpendLedgerEntries.userId, userId),
        eq(walletSpendLedgerEntries.type, "deposit_credit"),
      ))
      .orderBy(desc(walletSpendLedgerEntries.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      entryId: row.entryId,
      userId: row.userId,
      type: row.type,
      amountUsd: centsToUsd(row.amountUsdCents),
      ticketId: row.ticketId ?? null,
      executionJobId: row.executionJobId ?? null,
      chain: row.chain ?? null,
      txHash: row.txHash ?? null,
      logIndex: row.logIndex ?? null,
      circleTransferId: row.circleTransferId ?? null,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt,
    }));
  }

  async recordRefundCredit(input: {
    userId: string;
    amountUsd: number;
    referenceId: string;
    chain?: string | null;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null> {
    return this.recordDepositLedgerEntry("refund_credit", {
      userId: input.userId,
      amountUsd: input.amountUsd,
      chain: input.chain ?? null,
      txHash: null,
      circleTransferId: input.referenceId,
      metadata: input.metadata,
    });
  }

  async recordGatewayMint(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    amountUsd: number;
    chain: string;
    metadata?: unknown;
  }): Promise<WalletSpendLedgerEntry | null> {
    const amountUsdCents = positiveUsdToCents(input.amountUsd);
    return await this.db.transaction(async (tx) => {
      await lockWalletSpendUser(tx, input.ticket.userId);
      const existing = await tx
        .select()
        .from(walletSpendLedgerEntries)
        .where(
          and(
            eq(walletSpendLedgerEntries.type, "gateway_mint"),
            eq(walletSpendLedgerEntries.executionJobId, input.job.jobId),
          ),
        )
        .limit(1);
      if (existing[0]) return null;

      const entry = walletSpendLedgerEntry({
        userId: input.ticket.userId,
        type: "gateway_mint",
        amountUsdCents,
        ticketId: input.ticket.ticketId,
        executionJobId: input.job.jobId,
        chain: input.chain,
        metadata: input.metadata ?? null,
        createdAt: new Date().toISOString(),
      });
      await tx.insert(walletSpendLedgerEntries).values(entry);
      return {
        entryId: entry.entryId,
        userId: entry.userId,
        type: entry.type,
        amountUsd: centsToUsd(entry.amountUsdCents),
        ticketId: entry.ticketId,
        executionJobId: entry.executionJobId,
        chain: entry.chain ?? null,
        txHash: null,
        logIndex: null,
        circleTransferId: null,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      };
    });
  }

  private async recordDepositLedgerEntry(
    type: WalletSpendLedgerEntry["type"],
    input: {
      userId: string;
      amountUsd: number;
      chain: string | null;
      txHash: string | null;
      logIndex?: number | null;
      circleTransferId: string;
      metadata?: unknown;
    },
  ): Promise<WalletSpendLedgerEntry | null> {
    const amountUsdCents = positiveUsdToCents(input.amountUsd);
    return await this.db.transaction(async (tx) => {
      await lockWalletSpendUser(tx, input.userId);
      const existing = await tx
        .select()
        .from(walletSpendLedgerEntries)
        .where(
          and(
            eq(walletSpendLedgerEntries.type, type),
            eq(walletSpendLedgerEntries.circleTransferId, input.circleTransferId),
          ),
        )
        .limit(1);
      if (existing[0]) return null;
      if (input.txHash) {
        const existingTx = await tx
          .select()
          .from(walletSpendLedgerEntries)
          .where(
            and(
              eq(walletSpendLedgerEntries.type, type),
              eq(walletSpendLedgerEntries.txHash, input.txHash),
              input.chain == null
                ? sql`${walletSpendLedgerEntries.chain} is null`
                : eq(walletSpendLedgerEntries.chain, input.chain),
            ),
          )
          .limit(1);
        if (existingTx[0] && (existingTx[0].logIndex ?? 0) === (input.logIndex ?? 0)) {
          return null;
        }
      }
      const entry = walletSpendLedgerEntry({
        userId: input.userId,
        type,
        amountUsdCents,
        ticketId: null,
        executionJobId: null,
        chain: input.chain,
        txHash: input.txHash,
        logIndex: input.logIndex ?? null,
        circleTransferId: input.circleTransferId,
        metadata: input.metadata ?? null,
        createdAt: new Date().toISOString(),
      });
      await tx.insert(walletSpendLedgerEntries).values(entry);
      return {
        entryId: entry.entryId,
        userId: entry.userId,
        type: entry.type,
        amountUsd: centsToUsd(entry.amountUsdCents),
        ticketId: entry.ticketId,
        executionJobId: entry.executionJobId,
        chain: entry.chain ?? null,
        txHash: entry.txHash ?? null,
        logIndex: entry.logIndex ?? null,
        circleTransferId: entry.circleTransferId ?? null,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      };
    });
  }

  // Credited funds = deposits + refunds - settled spends. Reservations are
  // handled separately (openReservedUsdCents); prefund/release/mint entries
  // track physical money movement, not the user's credited balance.
  private async internalBalanceUsdCents(
    userId: string,
    db: Pick<CassieDb, "select"> = this.db,
  ): Promise<number> {
    const rows = await db
      .select()
      .from(walletSpendLedgerEntries)
      .where(eq(walletSpendLedgerEntries.userId, userId));

    return rows.reduce((total, entry) => {
      if (entry.type === "deposit_credit" || entry.type === "refund_credit") {
        return total + entry.amountUsdCents;
      }
      if (entry.type === "trade_spend") return total - entry.amountUsdCents;
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

    await this.db.insert(controlRuns).values(run);
    return run;
  }

  async updateRun(run: ControlRun): Promise<ControlRun> {
    await this.db
      .update(controlRuns)
      .set({
        userCommand: run.userCommand,
        sourcePost: run.sourcePost,
        status: run.status,
        result: run.result,
        error: run.error,
        updatedAt: run.updatedAt,
      })
      .where(eq(controlRuns.runId, run.runId));

    return run;
  }

  async claimRun(runId: string): Promise<ControlRun | null> {
    const now = new Date().toISOString();
    const rows = await this.db
      .update(controlRuns)
      .set({
        status: "running",
        error: null,
        updatedAt: now,
      })
      .where(
        and(eq(controlRuns.runId, runId), eq(controlRuns.status, "queued")),
      )
      .returning();

    const row = rows[0];
    return row ? { ...row, result: row.result ?? null } : null;
  }

  async getRun(runId: string): Promise<ControlRun | undefined> {
    const rows = await this.db
      .select()
      .from(controlRuns)
      .where(eq(controlRuns.runId, runId))
      .limit(1);

    const row = rows[0];
    return row ? { ...row, result: row.result ?? null } : undefined;
  }

  async addRunStep(input: NewRunStep): Promise<RunStep> {
    const step: RunStep = {
      ...input,
      stepId: randomUUID(),
      thinkingTrace: input.thinkingTrace ?? null,
      startedAt: new Date().toISOString(),
      completedAt: input.completedAt ?? null,
    };
    await this.db.insert(runSteps).values(step);
    return step;
  }

  async updateRunStep(step: RunStep): Promise<RunStep> {
    await this.db
      .update(runSteps)
      .set({
        stepType: step.stepType,
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error,
        model: step.model,
        promptName: step.promptName,
        promptVersion: step.promptVersion,
        thinkingTrace: step.thinkingTrace ?? null,
        completedAt: step.completedAt,
      })
      .where(eq(runSteps.stepId, step.stepId));

    return step;
  }

  async getRunSteps(runId: string): Promise<RunStep[]> {
    const rows = await this.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId));

    return rows.map((row) => ({
      ...row,
      input: row.input ?? null,
      output: row.output ?? null,
      thinkingTrace: row.thinkingTrace ?? null,
    }));
  }

  async addMention(
    input: Omit<MentionRecord, "mentionId" | "createdAt">,
  ): Promise<MentionRecord> {
    const mention: MentionRecord = {
      ...input,
      mentionId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(mentions).values(mention);
    await this.audit({
      entityId: mention.mentionId,
      entityType: "mention",
      eventType: "mention.received",
      message: "Cassie mention received.",
      data: mention,
    });

    return mention;
  }

  async addModelCallUsage(input: NewModelCallUsage) {
    const record = {
      ...input,
      id: randomUUID(),
      thinkingTrace: input.thinkingTrace ?? null,
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(modelCallUsage).values(record);
    return record;
  }

  async addTradeTicket(ticket: TradeTicket): Promise<TradeTicket> {
    const now = new Date().toISOString();
    await this.db.insert(tradeTickets).values({
      ticketId: ticket.ticketId,
      runId: ticket.runId ?? null,
      userId: ticket.userId,
      ticket,
      createdAt: now,
      updatedAt: now,
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
    await this.db
      .update(tradeTickets)
      .set({
        runId: ticket.runId ?? null,
        ticket,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tradeTickets.ticketId, ticket.ticketId));

    return ticket;
  }

  async getTradeTicket(ticketId: string): Promise<TradeTicket | undefined> {
    const rows = await this.db
      .select()
      .from(tradeTickets)
      .where(eq(tradeTickets.ticketId, ticketId))
      .limit(1);

    return rows[0]?.ticket;
  }

  async getTradeTickets(ticketIds: string[]): Promise<TradeTicket[]> {
    const uniqueIds = [...new Set(ticketIds)];
    if (uniqueIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(tradeTickets)
      .where(inArray(tradeTickets.ticketId, uniqueIds));

    return rows.map((row) => row.ticket);
  }

  async addExecutionJob(job: ExecutionJob): Promise<ExecutionJob> {
    await this.db.insert(executionJobs).values({
      jobId: job.jobId,
      ticketId: job.ticketId,
      job,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
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
    await this.db
      .update(executionJobs)
      .set({
        job,
        status: job.status,
        updatedAt: job.updatedAt,
      })
      .where(eq(executionJobs.jobId, job.jobId));

    return job;
  }

  async getExecutionJob(jobId: string): Promise<ExecutionJob | undefined> {
    const rows = await this.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.jobId, jobId))
      .limit(1);

    return rows[0]?.job;
  }

  async addPosition(position: Position): Promise<Position> {
    await this.db.insert(positions).values({
      positionId: position.positionId,
      userId: position.userId,
      ticketId: position.ticketId,
      executionJobId: position.executionJobId,
      status: position.status,
      position,
      openedAt: position.openedAt,
      updatedAt: position.updatedAt,
    });
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
    await this.db
      .update(positions)
      .set({
        status: position.status,
        position,
        updatedAt: position.updatedAt,
      })
      .where(eq(positions.positionId, position.positionId));
    return position;
  }

  async getPosition(positionId: string): Promise<Position | undefined> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.positionId, positionId))
      .limit(1);

    return rows[0]?.position;
  }

  async getPositionByExecutionJob(
    executionJobId: string,
  ): Promise<Position | undefined> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.executionJobId, executionJobId))
      .limit(1);

    return rows[0]?.position;
  }

  async listOpenPositions(userId?: string): Promise<Position[]> {
    const query = this.db.select().from(positions).$dynamic();
    const rows = await (
      userId
        ? query.where(
            and(eq(positions.status, "open"), eq(positions.userId, userId)),
          )
        : query.where(eq(positions.status, "open"))
    ).orderBy(asc(positions.openedAt));

    return rows.map((row) => row.position);
  }

  async listUserPositions(userId: string): Promise<Position[]> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.userId, userId))
      .orderBy(desc(positions.openedAt));

    return rows.map((row) => row.position);
  }

  async addPositionReview(review: PositionReview): Promise<PositionReview> {
    await this.db.insert(positionReviews).values({
      reviewId: review.reviewId,
      positionId: review.positionId,
      userId: review.userId,
      status: review.status,
      review,
      reviewedAt: review.reviewedAt,
    });
    return review;
  }

  async getLatestPositionReview(
    positionId: string,
  ): Promise<PositionReview | undefined> {
    const rows = await this.db
      .select()
      .from(positionReviews)
      .where(eq(positionReviews.positionId, positionId))
      .orderBy(desc(positionReviews.reviewedAt))
      .limit(1);

    return rows[0]?.review;
  }

  async getLatestPositionReviews(
    positionIds: string[],
  ): Promise<PositionReview[]> {
    const uniqueIds = [...new Set(positionIds)];
    if (uniqueIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(positionReviews)
      .where(inArray(positionReviews.positionId, uniqueIds))
      .orderBy(desc(positionReviews.reviewedAt));
    const latest = new Map<string, PositionReview>();
    for (const row of rows) {
      if (!latest.has(row.positionId)) {
        latest.set(row.positionId, row.review);
      }
    }
    return [...latest.values()];
  }

  async listPositionReviews(positionId: string): Promise<PositionReview[]> {
    const rows = await this.db
      .select()
      .from(positionReviews)
      .where(eq(positionReviews.positionId, positionId))
      .orderBy(asc(positionReviews.reviewedAt));

    return rows.map((row) => row.review);
  }

  async recordPortfolioBalanceSnapshot(
    input: Omit<PortfolioBalanceSnapshot, "snapshotId" | "at"> & {
      at?: string;
    },
  ): Promise<PortfolioBalanceSnapshot> {
    const latest = await this.db
      .select()
      .from(portfolioBalanceSnapshots)
      .where(eq(portfolioBalanceSnapshots.userId, input.userId))
      .orderBy(desc(portfolioBalanceSnapshots.at))
      .limit(1)
      .then((rows) => rows[0]?.snapshot);
    if (latest && samePortfolioBalanceSnapshot(latest, input)) return latest;

    const snapshot: PortfolioBalanceSnapshot = {
      snapshotId: randomUUID(),
      userId: input.userId,
      at: monotonicSnapshotAt(input.at ?? new Date().toISOString(), latest?.at),
      valueUsd: roundUsd(input.valueUsd),
      walletBalanceUsd: roundUsd(input.walletBalanceUsd),
      unrealizedPnlUsd: roundUsd(input.unrealizedPnlUsd),
    };
    await this.db.insert(portfolioBalanceSnapshots).values({
      snapshotId: snapshot.snapshotId,
      userId: snapshot.userId,
      snapshot,
      at: snapshot.at,
    });
    return snapshot;
  }

  async listPortfolioBalanceSnapshots(
    userId: string,
    limit: number,
  ): Promise<PortfolioBalanceSnapshot[]> {
    const rows = await this.db
      .select()
      .from(portfolioBalanceSnapshots)
      .where(eq(portfolioBalanceSnapshots.userId, userId))
      .orderBy(desc(portfolioBalanceSnapshots.at))
      .limit(limit);

    return rows
      .map((row) => row.snapshot)
      .sort((left, right) => left.at.localeCompare(right.at));
  }

  async getWalletFundingBalance(
    userId: string,
    walletBalanceUsd: number,
  ): Promise<WalletFundingBalance> {
    return walletFundingBalance({
      userId,
      walletBalanceUsdCents: nonnegativeUsdToCents(walletBalanceUsd),
      reservedUsdCents: await this.openReservedUsdCents(userId),
      updatedAt: new Date().toISOString(),
    });
  }

  async reserveWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    walletBalanceUsd: number;
  }): Promise<WalletFundingBalance> {
    const ticketSizeCents = positiveUsdToCents(input.ticket.sizeUsd);
    return await this.db.transaction(async (tx) => {
      await lockWalletSpendUser(tx, input.ticket.userId);
      const existingReserve = await tx
        .select()
        .from(walletSpendLedgerEntries)
        .where(
          and(
            eq(walletSpendLedgerEntries.type, "trade_reserve"),
            eq(walletSpendLedgerEntries.executionJobId, input.job.jobId),
          ),
        )
        .limit(1);
      if (existingReserve[0]) {
        return walletFundingBalance({
          userId: input.ticket.userId,
          walletBalanceUsdCents: nonnegativeUsdToCents(input.walletBalanceUsd),
          reservedUsdCents: await this.openReservedUsdCents(
            input.ticket.userId,
            tx,
          ),
          updatedAt: new Date().toISOString(),
        });
      }

      const walletBalanceUsdCents = nonnegativeUsdToCents(
        input.walletBalanceUsd,
      );
      const reservedUsdCents = await this.openReservedUsdCents(
        input.ticket.userId,
        tx,
      );
      if (walletBalanceUsdCents - reservedUsdCents < ticketSizeCents) {
        throw new Error("Insufficient user wallet balance.");
      }

      await tx.insert(walletSpendLedgerEntries).values(
        walletSpendLedgerEntry({
          userId: input.ticket.userId,
          type: "trade_reserve",
          amountUsdCents: ticketSizeCents,
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
    return await this.db.transaction(async (tx) => {
      await lockWalletSpendUser(tx, input.ticket.userId);
      const existingRelease = await tx
        .select()
        .from(walletSpendLedgerEntries)
        .where(
          and(
            eq(walletSpendLedgerEntries.type, "trade_release"),
            eq(walletSpendLedgerEntries.executionJobId, input.job.jobId),
          ),
        )
        .limit(1);
      if (existingRelease[0]) {
        return this.getWalletFundingBalance(
          input.ticket.userId,
          input.walletBalanceUsd,
        );
      }

      const walletBalanceUsdCents = nonnegativeUsdToCents(
        input.walletBalanceUsd,
      );
      const reservedUsdCents = await this.openReservedUsdCents(
        input.ticket.userId,
        tx,
      );
      if (reservedUsdCents < ticketSizeCents) {
        throw new Error("Cannot release a missing trade reservation.");
      }

      await tx.insert(walletSpendLedgerEntries).values(
        walletSpendLedgerEntry({
          userId: input.ticket.userId,
          type: "trade_release",
          amountUsdCents: ticketSizeCents,
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
    return await this.db.transaction(async (tx) => {
      await lockWalletSpendUser(tx, input.ticket.userId);
      const existingPrefund = await tx
        .select()
        .from(walletSpendLedgerEntries)
        .where(
          and(
            eq(walletSpendLedgerEntries.type, "trade_prefund"),
            eq(walletSpendLedgerEntries.executionJobId, input.job.jobId),
          ),
        )
        .limit(1);
      if (existingPrefund[0]) {
        return walletFundingBalance({
          userId: input.ticket.userId,
          walletBalanceUsdCents: nonnegativeUsdToCents(input.walletBalanceUsd),
          reservedUsdCents: await this.openReservedUsdCents(
            input.ticket.userId,
            tx,
          ),
          updatedAt: new Date().toISOString(),
        });
      }

      await tx.insert(walletSpendLedgerEntries).values(
        walletSpendLedgerEntry({
          userId: input.ticket.userId,
          type: "trade_prefund",
          amountUsdCents: prefundCents,
          ticketId: input.ticket.ticketId,
          executionJobId: input.job.jobId,
          metadata: input.metadata,
          createdAt: new Date().toISOString(),
        }),
      );
      return walletFundingBalance({
        userId: input.ticket.userId,
        walletBalanceUsdCents: nonnegativeUsdToCents(input.walletBalanceUsd),
        reservedUsdCents: await this.openReservedUsdCents(
          input.ticket.userId,
          tx,
        ),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async settleWalletSpend(input: {
    ticket: TradeTicket;
    job: ExecutionJob;
    executionResult: NonNullable<ExecutionJob["executionResult"]>;
    walletBalanceUsd: number;
    releaseMetadata?: unknown;
  }): Promise<WalletFundingBalance> {
    const ticketSizeCents = positiveUsdToCents(input.ticket.sizeUsd);
    return await this.db.transaction(async (tx) => {
      await lockWalletSpendUser(tx, input.ticket.userId);
      const existingSettlement = await tx
        .select()
        .from(walletSpendLedgerEntries)
        .where(
          and(
            eq(walletSpendLedgerEntries.type, "trade_spend"),
            eq(walletSpendLedgerEntries.executionJobId, input.job.jobId),
          ),
        )
        .limit(1);
      if (existingSettlement[0]) {
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
      const now = new Date().toISOString();
      const walletBalanceUsdCents = nonnegativeUsdToCents(
        input.walletBalanceUsd,
      );
      const reservedUsdCents = await this.openReservedUsdCents(
        input.ticket.userId,
        tx,
      );
      if (reservedUsdCents < ticketSizeCents) {
        throw new Error("Cannot settle a missing trade reservation.");
      }

      await tx.insert(walletSpendLedgerEntries).values(
        walletSpendLedgerEntry({
          userId: input.ticket.userId,
          type: "trade_spend",
          amountUsdCents: filledSizeCents,
          ticketId: input.ticket.ticketId,
          executionJobId: input.job.jobId,
          metadata: input.executionResult,
          createdAt: now,
        }),
      );

      if (releaseCents > 0) {
        await tx.insert(walletSpendLedgerEntries).values(
          walletSpendLedgerEntry({
            userId: input.ticket.userId,
            type: "trade_release",
            amountUsdCents: releaseCents,
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
    });
  }

  async listTradeTicketsWithoutExecutionJob(
    runId: string,
  ): Promise<TradeTicket[]> {
    const ticketRows = await this.db
      .select()
      .from(tradeTickets)
      .where(eq(tradeTickets.runId, runId));
    const tickets = ticketRows.map((row) => row.ticket);
    const ticketIds = tickets.map((ticket) => ticket.ticketId);

    if (ticketIds.length === 0) {
      return [];
    }

    const jobRows = await this.db
      .select({ ticketId: executionJobs.ticketId })
      .from(executionJobs)
      .where(inArray(executionJobs.ticketId, ticketIds));
    const existingExecutionTicketIds = new Set(
      jobRows.map((row) => row.ticketId),
    );

    return tickets.filter(
      (ticket) => !existingExecutionTicketIds.has(ticket.ticketId),
    );
  }

  async getNextQueuedExecutionJob(): Promise<ExecutionJob | undefined> {
    const rows = await this.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.status, "queued"))
      .limit(1);

    return rows[0]?.job;
  }

  async getRuntimeState<T = unknown>(key: string): Promise<T | undefined> {
    const rows = await this.db
      .select()
      .from(runtimeState)
      .where(eq(runtimeState.key, key))
      .limit(1);

    return rows[0]?.value as T | undefined;
  }

  async setRuntimeState(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(runtimeState)
      .values({
        key,
        value,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: runtimeState.key,
        set: {
          value,
          updatedAt: new Date().toISOString(),
        },
      });
  }

  async audit(
    input: Omit<AuditEvent, "eventId" | "createdAt">,
  ): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      eventId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(auditEvents).values(event);
    return event;
  }

  private async openReservedUsdCents(
    userId: string,
    db: Pick<CassieDb, "select"> = this.db,
  ): Promise<number> {
    const rows = await db
      .select()
      .from(walletSpendLedgerEntries)
      .where(eq(walletSpendLedgerEntries.userId, userId));

    return rows.reduce((total, entry) => {
      if (entry.type === "trade_reserve") return total + entry.amountUsdCents;
      if (entry.type === "trade_release" || entry.type === "trade_spend")
        return total - entry.amountUsdCents;
      return total;
    }, 0);
  }
}

function normalizeXUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized ? normalized : null;
}

async function lockWalletSpendUser(
  db: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  userId: string,
) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
  );
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

function walletSpendLedgerEntry(input: {
  userId: string;
  type: WalletSpendLedgerEntry["type"];
  amountUsdCents: number;
  ticketId: string | null;
  executionJobId: string | null;
  chain?: string | null;
  txHash?: string | null;
  logIndex?: number | null;
  circleTransferId?: string | null;
  metadata: unknown | null;
  createdAt: string;
}) {
  return {
    ...input,
    entryId: randomUUID(),
  };
}
