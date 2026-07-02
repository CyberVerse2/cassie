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
import type { UserDashboardData } from "../../../../../packages/core/db/store.ts";
import type { CassieActivityItem } from "../../lib/activity.ts";
import { depositWalletBalanceUsd } from "../../../../../packages/app/deposit-balance.ts";
import {
  decoratePosition,
  type UserFacingPosition,
} from "../positions/_lib/position-response.ts";

export const DASHBOARD_ACTIVITY_LIMIT = 80;
const PORTFOLIO_HISTORY_LIMIT = 500;

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
    openPositionEquityUsd: number;
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

type PositionReviewPayload = Awaited<
  ReturnType<CassieStore["getLatestPositionReviews"]>
>[number];

export type WalletBalanceGateway = {
  getUsdcBalanceUsd(input: { walletId: string }): Promise<number | null>;
};

export async function buildDashboardPayload(
  settings: UserSettings,
  store: CassieStore,
  walletGateway: WalletBalanceGateway,
): Promise<DashboardPayload> {
  const walletBalancePromise = settings.privyWalletId
    ? walletGateway.getUsdcBalanceUsd({ walletId: settings.privyWalletId })
    : Promise.resolve(null);
  const [walletBalanceUsd, dashboardData] = await Promise.all([
    walletBalancePromise,
    store.loadUserDashboardData(settings.userId, {
      activityLimit: DASHBOARD_ACTIVITY_LIMIT,
    }),
  ]);
  const depositAddress = await store.getDepositAddress(settings.userId);
  const depositBalanceUsd = depositAddress
    ? await depositWalletBalanceUsd(depositAddress)
    : null;
  const effectiveBalanceUsd = walletBalanceUsd == null && depositBalanceUsd == null
    ? null
    : (walletBalanceUsd ?? 0) + (depositBalanceUsd ?? 0);
  const balance =
    effectiveBalanceUsd != null
      ? await store.getWalletFundingBalance(settings.userId, effectiveBalanceUsd)
      : null;

  const positions = dashboardData.positions.sort((left, right) =>
    right.openedAt.localeCompare(left.openedAt),
  );
  const latestReviewsPromise = store.getLatestPositionReviews(
    positions.map((position) => position.positionId),
  );
  const tickets = dashboardData.tradeTickets;
  const ticketById = new Map(
    tickets.map((ticket) => [ticket.ticketId, ticket]),
  );
  const displayPositions = positions.map((position) =>
    decoratePosition(position, ticketById.get(position.ticketId)),
  );
  const latestReviewRows = await latestReviewsPromise;
  const latestReviews = new Map(
    latestReviewRows.map((review) => [review.positionId, review]),
  );
  const openPositions = displayPositions.filter(isDashboardOpenPosition);
  const walletBalance = balance?.walletBalanceUsd ?? 0;
  const unrealizedPnlUsd = roundUsd(
    openPositions.reduce(
      (total, position) => total + position.unrealizedPnlUsd,
      0,
    ),
  );
  const openPositionEquityUsd = roundUsd(
    openPositions.reduce(
      (total, position) => total + position.positionEquityUsd,
      0,
    ),
  );
  const portfolioBalanceUsd = roundUsd(walletBalance + openPositionEquityUsd);
  const snapshotAt = new Date().toISOString();
  await store.recordPortfolioBalanceSnapshot({
    userId: settings.userId,
    at: snapshotAt,
    valueUsd: portfolioBalanceUsd,
    walletBalanceUsd: walletBalance,
    unrealizedPnlUsd,
  });
  const portfolioHistory = await store.listPortfolioBalanceSnapshots(
    settings.userId,
    PORTFOLIO_HISTORY_LIMIT,
  );

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
      openPositionEquityUsd,
      unrealizedPnlUsd,
      history: portfolioHistory.map(portfolioHistoryPoint),
    },
    openPositions,
    closedPositions: displayPositions.filter(
      (position) => position.status === "closed",
    ),
    latestReviews: Object.fromEntries(
      positions.map((position) => [
        position.positionId,
        latestReviews.get(position.positionId) ?? null,
      ]),
    ),
    activity: buildUserActivity(settings.userId, dashboardData),
  };
}

function portfolioHistoryPoint(snapshot: {
  at: string;
  valueUsd: number;
  walletBalanceUsd: number;
  unrealizedPnlUsd: number;
}) {
  return {
    at: snapshot.at,
    label: formatChartLabel(snapshot.at),
    valueUsd: snapshot.valueUsd,
    walletBalanceUsd: snapshot.walletBalanceUsd,
    unrealizedPnlUsd: snapshot.unrealizedPnlUsd,
  };
}

function formatChartLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildUserActivity(
  userId: string,
  snapshot: UserDashboardData,
): CassieActivityItem[] {
  const runs = snapshot.controlRuns.filter((run) => run.userId === userId);
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const tickets = snapshot.tradeTickets.filter(
    (ticket) => ticket.userId === userId,
  );
  const ticketById = new Map(
    tickets.map((ticket) => [ticket.ticketId, ticket]),
  );
  const jobById = new Map(
    snapshot.executionJobs.map((job) => [job.jobId, job]),
  );
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
        return [
          tradeActivity(
            position,
            ticket,
            jobById.get(position.executionJobId) ?? null,
            runById.get(ticket.runId ?? ""),
          ),
          ...closeActivity(position, ticket, runById.get(ticket.runId ?? "")),
        ];
      }),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, DASHBOARD_ACTIVITY_LIMIT);
}

function isDashboardOpenPosition(position: UserFacingPosition) {
  return (
    position.status === "open" ||
    position.status === "closing" ||
    position.status === "close_failed"
  );
}

function runActivity(
  run: ControlRun,
  intent: "watch" | "countertrade" | undefined,
): CassieActivityItem | null {
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
    authorName: run.sourcePost.authorName,
    sourceText: run.sourcePost.text,
    error: run.error,
  };
}

const SELECTION_BOILERPLATE =
  /found in (live )?\w* ?metadata|maps (directly )?to the thesis|directly maps to/iu;

function displayInstrument(ticket: TradeTicket): string {
  const symbol = ticket.venueData?.symbol;
  if (symbol) {
    const bare = symbol.includes(":") ? symbol.slice(symbol.indexOf(":") + 1) : symbol;
    return bare.replace(/-PERP$/iu, "").toUpperCase();
  }
  return ticket.instrument.replace(/[-_]+/gu, " ");
}

function venueLabel(venue: string): string {
  if (venue === "hyperliquid") return "Hyperliquid perp";
  if (venue === "polymarket") return "Polymarket";
  return venue;
}

// Theses that are really market-selection justifications add nothing for the
// user; show the venue instead.
function displayThesis(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = summarize(value);
  if (SELECTION_BOILERPLATE.test(cleaned)) return null;
  return cleaned;
}

function activitySubtitle(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" \u00b7 ");
}

function closeActivity(
  position: Position,
  ticket: TradeTicket,
  run: ControlRun | undefined,
): CassieActivityItem[] {
  if (position.status !== "closed" || !position.closedAt) return [];
  return [
    {
      id: `${position.positionId}:close`,
      kind: "trade_close",
      at: position.closedAt,
      title: displayInstrument(ticket),
      subtitle: activitySubtitle([
        `${formatSignedUsd(position.unrealizedPnlUsd)} realized P/L`,
        venueLabel(ticket.venue),
        displayThesis(ticket.exitPlan.thesis ?? ticket.thesis),
      ]),
      status: position.status,
      amountUsd: null,
      instrument: ticket.instrument,
      venue: ticket.venue,
      side: null,
      source: run?.sourcePost.url ? "x" : "cassie",
      sourceUrl: run?.sourcePost.url ?? null,
      authorHandle: run?.sourcePost.authorHandle ?? null,
      authorName: run?.sourcePost.authorName ?? null,
      sourceText: run?.sourcePost.text ?? null,
      error: null,
    },
  ];
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
    title: displayInstrument(ticket),
    subtitle: activitySubtitle([
      venueLabel(ticket.venue),
      displayThesis(ticket.thesis),
    ]),
    status: position.status,
    amountUsd: position.filledSizeUsd,
    instrument: ticket.instrument,
    venue: ticket.venue,
    side: ticket.side,
    source: run?.sourcePost.url ? "x" : "cassie",
    sourceUrl: run?.sourcePost.url ?? null,
    authorHandle: run?.sourcePost.authorHandle ?? null,
    authorName: run?.sourcePost.authorName ?? null,
    sourceText: run?.sourcePost.text ?? null,
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

function formatSignedUsd(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}$${Math.abs(value).toFixed(2)}`;
}

function buildIntentByRunId(
  steps: RunStep[],
): Map<string, "watch" | "countertrade"> {
  const intents = new Map<string, "watch" | "countertrade">();
  for (const step of steps) {
    if (
      step.stepType !== "intake" ||
      step.status !== "succeeded" ||
      step.promptName !== "cassie_source_mode_classification"
    ) {
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
