import { NextResponse } from "next/server";
import type {
  ControlRun,
  ExecutionJob,
  TradeTicket,
  WalletSpendLedgerEntry,
  Withdrawal,
} from "../../../../../packages/core/schemas/index";
import type { CassieActivityItem } from "../../lib/activity";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

const ACTIVITY_LIMIT = 80;

export async function GET(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }

    const snapshot = await store.load();
    const runs = snapshot.controlRuns.filter((run) => run.userId === settings.userId);
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const tickets = snapshot.tradeTickets.filter((ticket) => ticket.userId === settings.userId);
    const jobByTicketId = new Map<string, ExecutionJob>();
    for (const job of snapshot.executionJobs) {
      const existing = jobByTicketId.get(job.ticketId);
      if (!existing || job.updatedAt > existing.updatedAt) {
        jobByTicketId.set(job.ticketId, job);
      }
    }

    const activity = [
      ...runs.map(runActivity),
      ...tickets.flatMap((ticket) => {
        const item = tradeActivity(ticket, jobByTicketId.get(ticket.ticketId) ?? null, runById.get(ticket.runId ?? ""));
        return item ? [item] : [];
      }),
      ...snapshot.walletSpendLedgerEntries
        .filter((entry) => entry.userId === settings.userId)
        .map(walletActivity),
      ...snapshot.withdrawals
        .filter((withdrawal) => withdrawal.userId === settings.userId)
        .map(withdrawalActivity),
    ]
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, ACTIVITY_LIMIT);

    return NextResponse.json({ activity });
  } catch (error) {
    return apiError(error);
  }
}

function runActivity(run: ControlRun): CassieActivityItem {
  return {
    id: run.runId,
    kind: "run",
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

function tradeActivity(ticket: TradeTicket, job: ExecutionJob | null, run: ControlRun | undefined): CassieActivityItem | null {
  const filledUsd = job?.executionResult?.filledSizeUsd ?? null;
  const at = job?.createdAt ?? run?.createdAt ?? null;
  if (!at) return null;
  return {
    id: ticket.ticketId,
    kind: "trade",
    at,
    title: `${ticket.instrument} ${ticket.side.toUpperCase()}`,
    subtitle: summarize(ticket.thesis),
    status: job?.status ?? "ticketed",
    amountUsd: filledUsd ?? ticket.sizeUsd,
    instrument: ticket.instrument,
    venue: ticket.venue,
    side: ticket.side,
    source: run?.sourcePost.url ? "x" : "cassie",
    sourceUrl: run?.sourcePost.url ?? null,
    authorHandle: run?.sourcePost.authorHandle ?? null,
    error: job?.failureReason ?? null,
  };
}

function walletActivity(entry: WalletSpendLedgerEntry): CassieActivityItem {
  return {
    id: entry.entryId,
    kind: "wallet",
    at: entry.createdAt,
    title: walletTitle(entry.type),
    subtitle: walletSubtitle(entry.type),
    status: entry.type,
    amountUsd: entry.amountUsd,
    instrument: "USDC",
    venue: null,
    side: null,
    source: "cassie",
    sourceUrl: null,
    authorHandle: null,
    error: null,
  };
}

function withdrawalActivity(withdrawal: Withdrawal): CassieActivityItem {
  return {
    id: withdrawal.withdrawalId,
    kind: "withdrawal",
    at: withdrawal.createdAt,
    title: "Withdraw USDC",
    subtitle: `To ${shortAddress(withdrawal.destinationAddress)}`,
    status: withdrawal.status,
    amountUsd: withdrawal.amountUsd,
    instrument: "USDC",
    venue: null,
    side: null,
    source: "cassie",
    sourceUrl: null,
    authorHandle: null,
    error: withdrawal.failureReason,
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

function walletTitle(type: WalletSpendLedgerEntry["type"]): string {
  if (type === "trade_reserve") return "Reserved trade funds";
  if (type === "trade_prefund") return "Prefunded venue wallet";
  if (type === "trade_release") return "Released trade reserve";
  return "Spent trade funds";
}

function walletSubtitle(type: WalletSpendLedgerEntry["type"]): string {
  if (type === "trade_reserve") return "USDC reserved before execution";
  if (type === "trade_prefund") return "USDC moved for execution";
  if (type === "trade_release") return "Unused USDC returned to spendable balance";
  return "USDC spent on a filled trade";
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
