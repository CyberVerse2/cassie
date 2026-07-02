import type {
  Position,
  RunStep,
  TradeTicket,
} from "../../../../../packages/core/schemas/index.ts";
import type { CassieStore } from "../../../../../packages/core/db/store.ts";
import type {
  FirstCallScenario,
  ReplayStage,
} from "../../components/first-call-data.ts";

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

  const winners = data.positions
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
    )
    .slice(0, SCENARIO_COUNT);

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
        text: truncate(source.text.replace(/https?:\/\/\S+/gu, ""), 260),
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

const STAGE_PACING_MS = 1800;

function stagesFromRunSteps(steps: RunStep[]): ReplayStage[] {
  const ordered = steps
    .filter((step) => step.status === "succeeded")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const stages: ReplayStage[] = [];
  const seen = new Set<string>();
  const assessments: string[] = [];

  for (const step of ordered) {
    const output = record(step.output);
    // Per-candidate assessments collapse into one stage below.
    if (step.stepType === "market_assessment") {
      const summary = text(output.semanticFitSummary);
      if (summary) assessments.push(summary);
      continue;
    }
    if (seen.has(step.stepType)) continue;

    const stage = stageForStep(step, output);
    if (!stage) continue;
    seen.add(step.stepType);
    if (step.stepType === "market_selection" && assessments.length > 0) {
      stages.push({
        stepType: "market_assessment",
        label: "Assessing fit",
        body: truncate(
          `${assessments.length} candidate${assessments.length === 1 ? "" : "s"} assessed. ${assessments[0]}`,
          170,
        ),
        ms: STAGE_PACING_MS,
      });
    }
    stages.push(stage);
  }
  return stages;
}

function stageForStep(
  step: RunStep,
  output: Record<string, unknown>,
): ReplayStage | null {
  const stage = (label: string, body: string | null): ReplayStage | null =>
    body
      ? {
          stepType: step.stepType,
          label,
          body: truncate(body, 170),
          ms: STAGE_PACING_MS,
        }
      : null;

  switch (step.stepType) {
    case "intake": {
      // Two intake flavors exist; only the mode classification narrates well.
      if (step.promptName !== "cassie_source_mode_classification") return null;
      return stage("Reading the post", text(output.headlineThesis));
    }
    case "context_discovery":
      return stage("Searching X for context", text(output.summary));
    case "opportunity": {
      const frame = record(output.opportunityFrame);
      const source = Object.keys(frame).length > 0 ? frame : output;
      return stage(
        "Framing the opportunity",
        text(source.opportunity) ?? text(source.marketImplication),
      );
    }
    case "trade_expression":
      return stage(
        "Choosing the expression",
        text(output.highestPurityExpression) ?? text(output.reason),
      );
    case "market_candidates": {
      const candidates = Array.isArray(step.output) ? step.output : [];
      const venues = [
        ...new Set(
          candidates
            .map((candidate) => text(record(candidate).venue))
            .filter(Boolean),
        ),
      ];
      return stage(
        "Searching venues",
        candidates.length === 0
          ? null
          : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} found${
              venues.length > 0 ? ` on ${venues.join(", ")}` : ""
            }.`,
      );
    }
    case "market_selection": {
      const market = record(output.selectedMarket);
      const symbol = text(market.symbol);
      return stage(
        "Quote & selection",
        symbol
          ? `Selected ${bareSymbol(symbol)} on ${text(market.venue) ?? "venue"}.`
          : null,
      );
    }
    case "ticket": {
      const size = numeric(output.sizeUsd);
      const symbol = text(record(output.venueData).symbol);
      const instrument = symbol ? bareSymbol(symbol) : text(output.instrument);
      const side = text(output.side);
      return stage(
        "Cutting the ticket",
        side && instrument
          ? `${side.toUpperCase()} ${instrument}${size ? ` · $${Math.round(size)}` : ""}.`
          : null,
      );
    }
    default:
      return null;
  }
}

function bareSymbol(symbol: string): string {
  const bare = symbol.includes(":")
    ? symbol.slice(symbol.indexOf(":") + 1)
    : symbol;
  return bare.replace(/-PERP$/iu, "").toUpperCase();
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

function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const cutoff = cleaned.lastIndexOf(" ", max);
  return `${cleaned.slice(0, cutoff > max * 0.6 ? cutoff : max).trim()}…`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
