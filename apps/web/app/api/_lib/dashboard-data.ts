import type {
  ControlRun,
  ExecutionJob,
  Position,
  RunStep,
  TradeTicket,
  UserSettings,
  WalletFundingBalance,
} from "../../../../../packages/core/schemas/index.ts";
import type { CassieStore } from "../../../../../packages/core/db/store.ts";
import type { CassieActivityItem } from "../../lib/activity.ts";
import { decoratePosition, type UserFacingPosition } from "../positions/_lib/position-response.ts";

const ACTIVITY_LIMIT = 80;

export type DashboardAccountSummary = {
  userId: string;
  walletAddress: string | null;
  defaultTradeSizeUsd: number;
  balance: WalletFundingBalance | null;
};

export type DashboardPayload = {
  account: DashboardAccountSummary;
  portfolioBalance: {
    currentUsd: number;
    walletBalanceUsd: number;
    unrealizedPnlUsd: number;
    history: Array<{
      at: string;
      label: string;
      valueUsd: number;
      walletBalanceUsd: number;
      unrealizedPnlUsd: number;
    }>;
  };
  openPositions: UserFacingPosition[];
  closedPositions: UserFacingPosition[];
  latestReviews: Record<string, PositionReviewPayload | null>;
  activity: CassieActivityItem[];
};

type PositionReviewPayload = Awaited<ReturnType<CassieStore["getLatestPositionReviews"]>>[number];

export type WalletBalanceGateway = {
  getUsdcBalanceUsd(privyWalletId: string): Promise<number | null>;
};

export async function buildDashboardPayload(
  settings: UserSettings,
  store: CassieStore,
  walletGateway: WalletBalanceGateway,
): Promise<DashboardPayload> {
  const walletBalanceUsd = settings.privyWalletId
    ? await walletGateway.getUsdcBalanceUsd(settings.privyWalletId)
    : null;
  const balance = walletBalanceUsd == null
    ? null
    : await store.getWalletFundingBalance(settings.userId, walletBalanceUsd);

  const snapshot = await store.load();
  const positions = snapshot.positions
    .filter((position) => position.userId === settings.userId)
    .sort((left, right) => right.openedAt.localeCompare(left.openedAt));
  const tickets = snapshot.tradeTickets.filter((ticket) => ticket.userId === settings.userId);
  const ticketById = new Map(tickets.map((ticket) => [ticket.ticketId, ticket]));
  const displayPositions = positions.map((position) =>
    decoratePosition(position, ticketById.get(position.ticketId))
  );
  const latestReviewRows = await store.getLatestPositionReviews(positions.map((position) => position.positionId));
  const latestReviews = new Map(latestReviewRows.map((review) => [review.positionId, review]));
  const openPositions = displayPositions.filter(isDashboardOpenPosition);
  const walletBalance = balance?.walletBalanceUsd ?? 0;
  const unrealizedPnlUsd = roundUsd(openPositions.reduce((total, position) => total + position.unrealizedPnlUsd, 0));
  const portfolioBalanceUsd = roundUsd(walletBalance + unrealizedPnlUsd);
  const snapshotAt = new Date().toISOString();

  return {
    account: {
      userId: settings.userId,
      walletAddress: settings.walletAddress,
      defaultTradeSizeUsd: settings.defaultTradeSizeUsd,
      balance,
    },
    portfolioBalance: {
      currentUsd: portfolioBalanceUsd,
      walletBalanceUsd: walletBalance,
      unrealizedPnlUsd,
      history: [{
        at: snapshotAt,
        label: formatChartLabel(snapshotAt),
        valueUsd: portfolioBalanceUsd,
        walletBalanceUsd: walletBalance,
        unrealizedPnlUsd,
      }],
    },
    openPositions,
    closedPositions: displayPositions.filter((position) => position.status === "closed"),
    latestReviews: Object.fromEntries(positions.map((position) => [
      position.positionId,
      latestReviews.get(position.positionId) ?? null,
    ])),
    activity: buildUserActivity(settings.userId, snapshot),
  };
}

function formatChartLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildUserActivity(
  userId: string,
  snapshot: Awaited<ReturnType<CassieStore["load"]>>,
): CassieActivityItem[] {
  const runs = snapshot.controlRuns.filter((run) => run.userId === userId);
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const tickets = snapshot.tradeTickets.filter((ticket) => ticket.userId === userId);
  const ticketById = new Map(tickets.map((ticket) => [ticket.ticketId, ticket]));
  const jobById = new Map(snapshot.executionJobs.map((job) => [job.jobId, job]));
  const intentByRunId = buildIntentByRunId(snapshot.runSteps);

  return [
    ...runs.flatMap((run) => {
      const item = runActivity(run, intentByRunId.get(run.runId));
      return item ? [item] : [];
    }),
    ...snapshot.positions
      .filter((position) => position.userId === userId)
      .flatMap((position) => {
        const ticket = ticketById.get(position.ticketId);
        if (!ticket) return [];
        return [tradeActivity(position, ticket, jobById.get(position.executionJobId) ?? null, runById.get(ticket.runId ?? ""))];
      }),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, ACTIVITY_LIMIT);
}

function isDashboardOpenPosition(position: UserFacingPosition) {
  return position.status === "open"
    || position.status === "closing"
    || position.status === "close_failed";
}

function runActivity(run: ControlRun, intent: "watch" | "countertrade" | undefined): CassieActivityItem | null {
  if (!intent) return null;
  return {
    id: run.runId,
    kind: intent === "countertrade" ? "counter" : "watch",
    at: run.createdAt,
    title: commandTitle(run.userCommand),
    subtitle: summarize(run.sourcePost.text),
    status: run.status,
    amountUsd: null,
    instrument: null,
    venue: null,
    side: null,
    source: run.sourcePost.url ? "x" : "cassie",
    sourceUrl: run.sourcePost.url,
    authorHandle: run.sourcePost.authorHandle,
    error: run.error,
  };
}

function tradeActivity(
  position: Position,
  ticket: TradeTicket,
  job: ExecutionJob | null,
  run: ControlRun | undefined,
): CassieActivityItem {
  return {
    id: position.positionId,
    kind: "trade",
    at: position.openedAt,
    title: `${ticket.instrument} ${ticket.side.toUpperCase()}`,
    subtitle: summarize(ticket.thesis),
    status: position.status,
    amountUsd: position.filledSizeUsd,
    instrument: ticket.instrument,
    venue: ticket.venue,
    side: ticket.side,
    source: run?.sourcePost.url ? "x" : "cassie",
    sourceUrl: run?.sourcePost.url ?? null,
    authorHandle: run?.sourcePost.authorHandle ?? null,
    error: position.failureReason ?? job?.failureReason ?? null,
  };
}

function commandTitle(command: string): string {
  return command.replace(/^@?\w+\s+/i, "").trim() || command;
}

function summarize(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 140) return cleaned;
  const cutoff = cleaned.lastIndexOf(" ", 140);
  return `${cleaned.slice(0, cutoff > 90 ? cutoff : 140).trim()}...`;
}

function buildIntentByRunId(steps: RunStep[]): Map<string, "watch" | "countertrade"> {
  const intents = new Map<string, "watch" | "countertrade">();
  for (const step of steps) {
    if (step.stepType !== "intake" || step.status !== "succeeded" || step.promptName !== "cassie_source_mode_classification") {
      continue;
    }
    const output = objectRecord(step.output);
    if (output.userIntent === "watch" || output.userIntent === "countertrade") {
      intents.set(step.runId, output.userIntent);
    }
  }
  return intents;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
