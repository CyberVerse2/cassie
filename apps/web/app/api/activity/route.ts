import { NextResponse } from "next/server";
import type {
  ControlRun,
  ExecutionJob,
  Position,
  RunStep,
  TradeTicket,
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
    const ticketById = new Map(tickets.map((ticket) => [ticket.ticketId, ticket]));
    const jobById = new Map(snapshot.executionJobs.map((job) => [job.jobId, job]));
    const intentByRunId = buildIntentByRunId(snapshot.runSteps);

    const activity = [
      ...runs.flatMap((run) => {
        const item = runActivity(run, intentByRunId.get(run.runId));
        return item ? [item] : [];
      }),
      ...snapshot.positions
        .filter((position) => position.userId === settings.userId)
        .flatMap((position) => {
          const ticket = ticketById.get(position.ticketId);
          if (!ticket) return [];
          return [tradeActivity(position, ticket, jobById.get(position.executionJobId) ?? null, runById.get(ticket.runId ?? ""))];
        }),
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

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
