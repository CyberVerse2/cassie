import type {
  RunStep,
  TradeTicket,
} from "../../../../../packages/core/schemas/index.ts";
import type { CassieStore } from "../../../../../packages/core/db/store.ts";
import type { TapeCall } from "../../lib/tape.ts";
import { cleanSourceText } from "./source-text.ts";

// Look further back than we show: runs that produced neither a position nor a
// watch are filtered out below.
const TAPE_RUN_LIMIT = 120;
const TAPE_CALL_LIMIT = 30;

// The global tape: every user's calls, most profitable first. Watches and
// counters carry no PnL and trail the trades, newest first.
export async function buildGlobalTape(store: CassieStore): Promise<TapeCall[]> {
  const data = await store.loadGlobalTapeData({ runLimit: TAPE_RUN_LIMIT });
  const ticketByRunId = new Map(
    data.tradeTickets
      .filter((ticket) => ticket.runId)
      .map((ticket) => [ticket.runId as string, ticket]),
  );
  const positionByTicketId = new Map(
    data.positions.map((position) => [position.ticketId, position]),
  );
  const profileByUserId = new Map(
    data.userSettings.map((settings) => [settings.userId, settings.profile]),
  );
  const intentByRunId = buildIntentByRunId(data.runSteps);

  const calls: TapeCall[] = [];
  for (const run of data.controlRuns) {
    const source = run.sourcePost;
    if (!source.url) continue;
    const ticket = ticketByRunId.get(run.runId);
    const position = ticket
      ? positionByTicketId.get(ticket.ticketId)
      : undefined;
    const intent = intentByRunId.get(run.runId);
    // Runs that neither traded nor watch anything add no signal to the tape.
    if (!position && !intent) continue;

    const trader = profileByUserId.get(run.userId);
    calls.push({
      id: run.runId,
      at: run.createdAt,
      kind: position ? "trade" : intent === "countertrade" ? "counter" : "watch",
      sourceUrl: source.url,
      authorHandle: source.authorHandle,
      authorName: source.authorName,
      sourceText: source.text ? cleanSourceText(source.text) : source.text,
      mediaUrls: source.mediaUrls ?? [],
      traderHandle: trader?.handle ?? null,
      prompt:
        position && ticket
          ? tradePrompt(ticket)
          : intent === "countertrade"
            ? "countertrade"
            : "watch",
      venue: ticket?.venue ?? null,
      positionId: position?.positionId ?? null,
      pnlUsd: position ? round2(position.unrealizedPnlUsd) : null,
      pnlPct: position ? round2(position.unrealizedPnlPct) : null,
      closed: position?.status === "closed",
    });
  }

  // Sort by return pct — the number shown on the card — so the tape reads
  // monotonically. Watches carry no PnL and trail the trades, newest first.
  calls.sort((left, right) => {
    if (left.pnlPct != null && right.pnlPct != null) {
      return right.pnlPct - left.pnlPct;
    }
    if (left.pnlPct != null) return -1;
    if (right.pnlPct != null) return 1;
    return right.at.localeCompare(left.at);
  });
  return calls.slice(0, TAPE_CALL_LIMIT);
}

function tradePrompt(ticket: TradeTicket): string {
  const symbol = ticket.venueData?.symbol;
  const instrument = symbol
    ? (symbol.includes(":") ? symbol.slice(symbol.indexOf(":") + 1) : symbol)
        .replace(/-PERP$/iu, "")
        .toUpperCase()
    : ticket.instrument.replace(/[-_]+/gu, " ");
  return `${instrument} ${ticket.side.toUpperCase()}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
    const output =
      step.output && typeof step.output === "object" && !Array.isArray(step.output)
        ? (step.output as Record<string, unknown>)
        : {};
    if (output.userIntent === "watch" || output.userIntent === "countertrade") {
      intents.set(step.runId, output.userIntent);
    }
  }
  return intents;
}
