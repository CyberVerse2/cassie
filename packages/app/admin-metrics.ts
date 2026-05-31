import type {
  ControlRun,
  ControlRunStatus,
  ExecutionJob,
  RunStep,
  TradeTicket,
} from "../core/schemas/index.ts";
import type { CassieStoreSnapshot } from "../core/db/store.ts";

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RUNS_TREND_DAYS = 14;
const RECENT_FAILURE_LIMIT = 12;
const AUDIT_LIMIT = 40;

export interface AdminWebhookReceipt {
  receivedAt: string;
}

export interface AdminMetricsInput {
  snapshot: CassieStoreSnapshot;
  webhookReceipts: AdminWebhookReceipt[];
  now?: string;
}

export interface AdminOverview {
  totals: {
    users: number;
    activeUsers: number;
    mentions: number;
    runs: number;
    tokensConsumed: number;
    tickets: number;
    executedVolumeUsd: number;
    failedJobs: number;
  };
  runsTrend: { date: string; runs: number }[];
}

export interface AdminUserRow {
  userId: string;
  walletAddress: string | null;
  telegram: string | null;
  telegramConnected: boolean;
  funded: boolean;
  mentions: number;
  runs: number;
  volumeUsd: number;
  lastActive: string | null;
}

export interface AdminRunRow {
  runId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  status: ControlRunStatus;
  authorHandle: string | null;
  sourceText: string;
  sourceUrl: string | null;
  responseType: string | null;
  decision: string | null;
  ticketId: string | null;
  failureReason: string | null;
}

export interface AdminTradeRow {
  ticketId: string;
  runId: string | null;
  userId: string;
  venue: string;
  instrument: string;
  side: string;
  sizeUsd: number;
  createdAt: string;
  jobId: string | null;
  status: ExecutionJob["status"] | "no_job";
  filledSizeUsd: number | null;
  averagePrice: number | null;
  venueOrderId: string | null;
  failureReason: string | null;
}

export interface AdminOps {
  webhook: {
    lastReceivedAt: string | null;
    receivedLast24h: number;
    tracked: number;
  };
  queue: {
    runsQueued: number;
    runsRunning: number;
    jobsQueued: number;
    jobsRunning: number;
    backlog: number;
  };
  workerFailures: {
    failedRuns: number;
    failedJobs: number;
    failedSteps: number;
    recent: { kind: "run" | "execution_job" | "run_step"; id: string; reason: string; at: string }[];
  };
  modelCosts: {
    totalCostUsd: number;
    totalCalls: number;
    failedCalls: number;
    totalTokens: number;
    byModel: { model: string; provider: string; calls: number; costUsd: number; tokens: number }[];
  };
  audit: {
    eventId: string;
    entityType: string;
    entityId: string;
    eventType: string;
    message: string;
    createdAt: string;
  }[];
}

export interface AdminData {
  generatedAt: string;
  overview: AdminOverview;
  users: AdminUserRow[];
  runs: AdminRunRow[];
  trades: AdminTradeRow[];
  ops: AdminOps;
}

interface SupervisorResultShape {
  responseType?: string;
  actionState?: string;
  ticketId?: string | null;
  publicSummary?: string;
}

function readSupervisorResult(result: unknown): SupervisorResultShape | null {
  if (result == null || typeof result !== "object") return null;
  return result as SupervisorResultShape;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function buildAdminData(input: AdminMetricsInput): AdminData {
  const { snapshot } = input;
  const nowIso = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  const spendByUser = new Map<string, number>();
  const ledgerUserIds = new Set<string>();
  let executedVolumeUsd = 0;
  for (const entry of snapshot.walletSpendLedgerEntries) {
    ledgerUserIds.add(entry.userId);
    if (entry.type === "trade_spend") {
      executedVolumeUsd += entry.amountUsd;
      spendByUser.set(entry.userId, (spendByUser.get(entry.userId) ?? 0) + entry.amountUsd);
    }
  }

  const mentionsByUser = new Map<string, number>();
  const lastActiveByUser = new Map<string, string | null>();
  for (const mention of snapshot.mentions) {
    mentionsByUser.set(mention.userId, (mentionsByUser.get(mention.userId) ?? 0) + 1);
    lastActiveByUser.set(
      mention.userId,
      maxIso(lastActiveByUser.get(mention.userId) ?? null, mention.createdAt),
    );
  }

  const runsByUser = new Map<string, number>();
  for (const run of snapshot.controlRuns) {
    runsByUser.set(run.userId, (runsByUser.get(run.userId) ?? 0) + 1);
    const runActive = maxIso(run.createdAt, run.updatedAt);
    lastActiveByUser.set(
      run.userId,
      maxIso(lastActiveByUser.get(run.userId) ?? null, runActive),
    );
  }

  const users: AdminUserRow[] = snapshot.userSettings.map((settings) => {
    const lastActive = lastActiveByUser.get(settings.userId) ?? null;
    const telegram = settings.telegram ?? null;
    return {
      userId: settings.userId,
      walletAddress: settings.walletAddress ?? null,
      telegram: telegram ? telegram.username ?? telegram.firstName ?? "connected" : null,
      telegramConnected: Boolean(telegram),
      funded: ledgerUserIds.has(settings.userId),
      mentions: mentionsByUser.get(settings.userId) ?? 0,
      runs: runsByUser.get(settings.userId) ?? 0,
      volumeUsd: spendByUser.get(settings.userId) ?? 0,
      lastActive,
    };
  });
  users.sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

  const activeUsers = users.filter((user) =>
    user.lastActive != null && nowMs - Date.parse(user.lastActive) <= ACTIVE_WINDOW_MS
  ).length;

  const runsTrend = buildRunsTrend(snapshot.controlRuns, nowMs);

  const runs: AdminRunRow[] = snapshot.controlRuns
    .map((run) => {
      const result = readSupervisorResult(run.result);
      return {
        runId: run.runId,
        userId: run.userId,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        status: run.status,
        authorHandle: run.sourcePost.authorHandle,
        sourceText: run.sourcePost.text,
        sourceUrl: run.sourcePost.url,
        responseType: result?.responseType ?? null,
        decision: result?.actionState ?? null,
        ticketId: result?.ticketId ?? null,
        failureReason: run.error ?? null,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const jobByTicketId = new Map<string, ExecutionJob>();
  for (const job of snapshot.executionJobs) {
    const existing = jobByTicketId.get(job.ticketId);
    if (!existing || job.updatedAt > existing.updatedAt) {
      jobByTicketId.set(job.ticketId, job);
    }
  }
  const ticketCreatedAt = new Map<string, string>();

  const trades: AdminTradeRow[] = snapshot.tradeTickets
    .map((ticket): AdminTradeRow => {
      const job = jobByTicketId.get(ticket.ticketId) ?? null;
      const createdAt = job?.createdAt ?? ticketCreatedAt.get(ticket.ticketId) ?? "";
      return {
        ticketId: ticket.ticketId,
        runId: ticket.runId ?? null,
        userId: ticket.userId,
        venue: ticket.venue,
        instrument: ticket.instrument,
        side: ticket.side,
        sizeUsd: ticket.sizeUsd,
        createdAt,
        jobId: job?.jobId ?? null,
        status: job?.status ?? "no_job",
        filledSizeUsd: job?.executionResult?.filledSizeUsd ?? null,
        averagePrice: job?.executionResult?.averagePrice ?? null,
        venueOrderId: job?.executionResult?.venueOrderId ?? null,
        failureReason: job?.failureReason ?? null,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const ops = buildOps(input, nowMs);

  return {
    generatedAt: nowIso,
    overview: {
      totals: {
        users: snapshot.userSettings.length,
        activeUsers,
        mentions: snapshot.mentions.length,
        runs: snapshot.controlRuns.length,
        tokensConsumed: snapshot.modelCallUsage.reduce((sum, usage) => sum + (usage.totalTokens ?? 0), 0),
        tickets: snapshot.tradeTickets.length,
        executedVolumeUsd,
        failedJobs: snapshot.executionJobs.filter((job) => job.status === "failed").length,
      },
      runsTrend,
    },
    users,
    runs,
    trades,
    ops,
  };
}

function buildRunsTrend(controlRuns: ControlRun[], nowMs: number): { date: string; runs: number }[] {
  const counts = new Map<string, number>();
  for (const run of controlRuns) {
    counts.set(dayKey(run.createdAt), (counts.get(dayKey(run.createdAt)) ?? 0) + 1);
  }
  const trend: { date: string; runs: number }[] = [];
  for (let i = RUNS_TREND_DAYS - 1; i >= 0; i--) {
    const date = new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10);
    trend.push({ date, runs: counts.get(date) ?? 0 });
  }
  return trend;
}

function buildOps(input: AdminMetricsInput, nowMs: number): AdminOps {
  const { snapshot } = input;

  const receipts = input.webhookReceipts
    .map((receipt) => receipt.receivedAt)
    .filter((value): value is string => typeof value === "string");
  const lastReceivedAt = receipts.reduce<string | null>(
    (latest, value) => maxIso(latest, value),
    null,
  );
  const receivedLast24h = receipts.filter(
    (value) => nowMs - Date.parse(value) <= DAY_MS,
  ).length;

  const runsQueued = snapshot.controlRuns.filter((run) => run.status === "queued").length;
  const runsRunning = snapshot.controlRuns.filter((run) => run.status === "running").length;
  const jobsQueued = snapshot.executionJobs.filter((job) => job.status === "queued").length;
  const jobsRunning = snapshot.executionJobs.filter((job) => job.status === "running").length;

  const failedRunRecords = snapshot.controlRuns.filter((run) => run.status === "failed");
  const failedJobRecords = snapshot.executionJobs.filter((job) => job.status === "failed");
  const failedStepRecords = snapshot.runSteps.filter((step) => step.status === "failed");

  const recent = [
    ...failedRunRecords.map((run) => ({
      kind: "run" as const,
      id: run.runId,
      reason: run.error ?? "Run failed.",
      at: run.updatedAt,
    })),
    ...failedJobRecords.map((job) => ({
      kind: "execution_job" as const,
      id: job.jobId,
      reason: job.failureReason ?? "Execution failed.",
      at: job.updatedAt,
    })),
    ...failedStepRecords.map((step) => ({
      kind: "run_step" as const,
      id: step.stepId,
      reason: step.error ?? `${step.stepType} step failed.`,
      at: step.completedAt ?? step.startedAt,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_FAILURE_LIMIT);

  let totalCostUsd = 0;
  let totalTokens = 0;
  let failedCalls = 0;
  const byModelMap = new Map<string, { model: string; provider: string; calls: number; costUsd: number; tokens: number }>();
  for (const usage of snapshot.modelCallUsage) {
    totalCostUsd += usage.estimatedCostUsd ?? 0;
    totalTokens += usage.totalTokens ?? 0;
    if (usage.status === "failed") failedCalls += 1;
    const key = `${usage.provider}:${usage.model}`;
    const bucket = byModelMap.get(key) ?? {
      model: usage.model,
      provider: usage.provider,
      calls: 0,
      costUsd: 0,
      tokens: 0,
    };
    bucket.calls += 1;
    bucket.costUsd += usage.estimatedCostUsd ?? 0;
    bucket.tokens += usage.totalTokens ?? 0;
    byModelMap.set(key, bucket);
  }
  const byModel = [...byModelMap.values()].sort((a, b) => b.costUsd - a.costUsd);

  const audit = [...snapshot.auditEvents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, AUDIT_LIMIT)
    .map((event) => ({
      eventId: event.eventId,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      message: event.message,
      createdAt: event.createdAt,
    }));

  return {
    webhook: {
      lastReceivedAt,
      receivedLast24h,
      tracked: receipts.length,
    },
    queue: {
      runsQueued,
      runsRunning,
      jobsQueued,
      jobsRunning,
      backlog: runsQueued + runsRunning + jobsQueued + jobsRunning,
    },
    workerFailures: {
      failedRuns: failedRunRecords.length,
      failedJobs: failedJobRecords.length,
      failedSteps: failedStepRecords.length,
      recent,
    },
    modelCosts: {
      totalCostUsd,
      totalCalls: snapshot.modelCallUsage.length,
      failedCalls,
      totalTokens,
      byModel,
    },
    audit,
  };
}

/* ─── run detail ──────────────────────────────────────────────── */

export interface AdminRunModelCall {
  id: string;
  purpose: string;
  provider: string;
  model: string;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface AdminRunDetailInput {
  run: ControlRun;
  steps: RunStep[];
  tickets: TradeTicket[];
  jobs: ExecutionJob[];
  modelCalls: AdminRunModelCall[];
}

export interface AdminRunStepDetail {
  stepId: string;
  stepType: string;
  status: string;
  model: string | null;
  promptName: string | null;
  promptVersion: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  thinkingTrace: string | null;
}

export interface AdminRunTicketDetail {
  ticketId: string;
  venue: string;
  instrument: string;
  side: string;
  sizeUsd: number;
  thesis: string;
  job: {
    jobId: string;
    status: ExecutionJob["status"];
    failureReason: string | null;
    filledSizeUsd: number | null;
    averagePrice: number | null;
    venueOrderId: string | null;
  } | null;
}

export interface AdminRunDetail {
  runId: string;
  userId: string;
  status: ControlRunStatus;
  userCommand: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  sourcePost: {
    authorHandle: string | null;
    authorName: string | null;
    text: string;
    url: string | null;
    createdAt: string | null;
  };
  result: {
    responseType: string | null;
    actionState: string | null;
    publicSummary: string | null;
    ticketId: string | null;
    warnings: string[];
  } | null;
  steps: AdminRunStepDetail[];
  tickets: AdminRunTicketDetail[];
  modelCalls: AdminRunModelCall[];
  totals: {
    steps: number;
    failedSteps: number;
    modelCalls: number;
    modelCostUsd: number;
    tokens: number;
  };
}

function durationMs(startedAt: string, completedAt: string | null): number | null {
  if (!completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

export function buildRunDetail(input: AdminRunDetailInput): AdminRunDetail {
  const { run } = input;
  const result = readSupervisorResult(run.result);
  const warnings = Array.isArray((result as { warnings?: unknown })?.warnings)
    ? ((result as { warnings: unknown[] }).warnings.filter((value): value is string => typeof value === "string"))
    : [];

  const steps: AdminRunStepDetail[] = [...input.steps]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((step) => ({
      stepId: step.stepId,
      stepType: step.stepType,
      status: step.status,
      model: step.model,
      promptName: step.promptName,
      promptVersion: step.promptVersion,
      error: step.error,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      durationMs: durationMs(step.startedAt, step.completedAt),
      input: step.input ?? null,
      output: step.output ?? null,
      thinkingTrace: step.thinkingTrace ?? null,
    }));

  const jobByTicketId = new Map<string, ExecutionJob>();
  for (const job of input.jobs) {
    const existing = jobByTicketId.get(job.ticketId);
    if (!existing || job.updatedAt > existing.updatedAt) {
      jobByTicketId.set(job.ticketId, job);
    }
  }

  const tickets: AdminRunTicketDetail[] = input.tickets.map((ticket) => {
    const job = jobByTicketId.get(ticket.ticketId) ?? null;
    return {
      ticketId: ticket.ticketId,
      venue: ticket.venue,
      instrument: ticket.instrument,
      side: ticket.side,
      sizeUsd: ticket.sizeUsd,
      thesis: ticket.thesis,
      job: job
        ? {
            jobId: job.jobId,
            status: job.status,
            failureReason: job.failureReason ?? null,
            filledSizeUsd: job.executionResult?.filledSizeUsd ?? null,
            averagePrice: job.executionResult?.averagePrice ?? null,
            venueOrderId: job.executionResult?.venueOrderId ?? null,
          }
        : null,
    };
  });

  const modelCalls = [...input.modelCalls].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    runId: run.runId,
    userId: run.userId,
    status: run.status,
    userCommand: run.userCommand,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    error: run.error ?? null,
    sourcePost: {
      authorHandle: run.sourcePost.authorHandle,
      authorName: run.sourcePost.authorName,
      text: run.sourcePost.text,
      url: run.sourcePost.url,
      createdAt: run.sourcePost.createdAt,
    },
    result: result
      ? {
          responseType: result.responseType ?? null,
          actionState: result.actionState ?? null,
          publicSummary: result.publicSummary ?? null,
          ticketId: result.ticketId ?? null,
          warnings,
        }
      : null,
    steps,
    tickets,
    modelCalls,
    totals: {
      steps: steps.length,
      failedSteps: steps.filter((step) => step.status === "failed").length,
      modelCalls: modelCalls.length,
      modelCostUsd: modelCalls.reduce((sum, call) => sum + (call.estimatedCostUsd ?? 0), 0),
      tokens: modelCalls.reduce((sum, call) => sum + (call.totalTokens ?? 0), 0),
    },
  };
}
