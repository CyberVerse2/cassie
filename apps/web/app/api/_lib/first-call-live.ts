import type {
  Position,
  TradeTicket,
} from "../../../../../packages/core/schemas/index.ts";
import type { CassieStore } from "../../../../../packages/core/db/store.ts";
import type { FirstCallScenario } from "../../components/first-call-data.ts";
import { bareSymbol, stagesFromRunSteps, truncate } from "./run-stages.ts";
import { cleanSourceText } from "./source-text.ts";

// Look well past the tape window: the best trades are not always recent.
const SCENARIO_RUN_LIMIT = 400;
const SCENARIO_COUNT = 3;

// Builds first-call intro scenarios from the best-performing closed trades:
// the real source post, the run's real pipeline steps summarized into replay
// stages, and the trade's actual outcome. Returns [] when the book has no
// closed winners yet — the client falls back to the authored scenarios.
export async function buildLiveFirstCallScenarios(
  store: CassieStore,
): Promise<FirstCallScenario[]> {
  const data = await store.loadGlobalTapeData({ runLimit: SCENARIO_RUN_LIMIT });
  const runById = new Map(data.controlRuns.map((run) => [run.runId, run]));
  const ticketById = new Map(
    data.tradeTickets.map((ticket) => [ticket.ticketId, ticket]),
  );

  const ranked = data.positions
    .filter(
      (position) =>
        position.status === "closed" &&
        position.closedAt &&
        position.unrealizedPnlPct > 0,
    )
    .flatMap((position) => {
      const ticket = ticketById.get(position.ticketId);
      const run = ticket?.runId ? runById.get(ticket.runId) : undefined;
      if (!ticket || !run) return [];
      const source = run.sourcePost;
      if (!source.url || !source.authorHandle || !source.text) return [];
      // The intro asks the user to reply to the post; a bare status URL as
      // "text" (unresolved source) makes a meaningless card.
      if (/^https?:\/\/\S+$/u.test(source.text.trim())) return [];
      return [{ position, ticket, run }];
    })
    .sort(
      (left, right) =>
        right.position.unrealizedPnlPct - left.position.unrealizedPnlPct,
    );

  // Posts with an image make far better demo cards; text-only winners only
  // fill in when there aren't enough with media.
  const hasMedia = (entry: (typeof ranked)[number]) =>
    (entry.run.sourcePost.mediaUrls?.length ?? 0) > 0;
  const winners = [
    ...ranked.filter(hasMedia),
    ...ranked.filter((entry) => !hasMedia(entry)),
  ].slice(0, SCENARIO_COUNT);

  return Promise.all(
    winners.map(async ({ position, ticket, run }) => {
      const steps = await store.getRunSteps(run.runId);
      const source = run.sourcePost;
      return {
        id: run.runId,
        authorName: source.authorName ?? `@${source.authorHandle}`,
        handle: `@${source.authorHandle}`,
        avatarUrl: `https://unavatar.io/x/${source.authorHandle}`,
        date: shortDate(source.createdAt ?? run.createdAt),
        text: truncate(cleanSourceText(source.text), 260),
        url: source.url as string,
        mediaUrls: source.mediaUrls ?? [],
        stages: stagesFromRunSteps(steps),
        result: {
          side: displaySide(ticket),
          symbol: displayInstrument(ticket),
          venue: ticket.venue === "polymarket" ? "Polymarket" : "Hyperliquid",
          detail: `$${Math.round(position.filledSizeUsd)} · ${
            ticket.venue === "polymarket" ? "prediction market" : "perp"
          }`,
          entry: formatPrice(position.entryPrice, ticket.venue),
          exit: formatPrice(position.currentMarkPrice, ticket.venue),
          pnlPct: round1(position.unrealizedPnlPct),
          holdDays: holdDays(position),
          thesis: truncate(ticket.exitPlan.thesis ?? ticket.thesis, 140),
        },
      } satisfies FirstCallScenario;
    }),
  );
}

function displayInstrument(ticket: TradeTicket): string {
  const symbol = ticket.venueData?.symbol;
  if (symbol) return bareSymbol(symbol);
  return ticket.instrument.replace(/[-_]+/gu, " ");
}

function displaySide(ticket: TradeTicket): string {
  const side = ticket.side.toLowerCase();
  if (side === "buy_yes" || side === "buy") return "YES";
  if (side === "buy_no") return "NO";
  return side.toUpperCase();
}

function formatPrice(value: number | null, venue: string): string {
  if (value == null) return "—";
  if (venue === "polymarket") return `${Math.round(value * 100)}¢`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 10 ? 3 : 2 })}`;
}

function holdDays(position: Position): number {
  const opened = Date.parse(position.openedAt);
  const closed = Date.parse(position.closedAt ?? position.updatedAt);
  return Math.max(1, Math.round((closed - opened) / 86_400_000));
}

function shortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
