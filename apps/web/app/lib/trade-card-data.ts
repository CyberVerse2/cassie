import { DrizzleCassieStore } from "../../../../packages/core/db/drizzle-store.ts";
import type { CassieStore } from "../../../../packages/core/db/store.ts";
import type { ControlRun, Position, PositionReview, RunStep, TradeTicket } from "../../../../packages/core/schemas/index.ts";

type TradeCardThesis = {
  label: string;
  text: string;
};

type TradeCardPoint = {
  x: number;
  y: number;
  label: string;
};

type TradeCardProps = {
  author?: {
    name: string;
    date: string;
    avatarUrl?: string;
  };
  headline?: string;
  thesis?: TradeCardThesis[];
  points?: TradeCardPoint[];
  pnl?: {
    label: string;
    percent: string;
    side: string;
    when: string;
    entry: string;
    exit: string;
  };
  market?: {
    venue: string;
    question: string;
    side: string;
    entry: string;
    exit: string;
    logoUrl?: string;
  };
  variant?: "split" | "band";
};

export type TradeCardThesisDetails = {
  signal: string;
  why: string;
  invalidation: string;
};

export class TradeShareNotFoundError extends Error {
  constructor(positionId: string) {
    super(`Trade position ${positionId} was not found.`);
    this.name = "TradeShareNotFoundError";
  }
}

export type TradeShareData = {
  position: Position;
  ticket: TradeTicket;
  run: ControlRun | undefined;
  steps: RunStep[];
  review: PositionReview | undefined;
  thesisDetails: TradeCardThesisDetails;
  cardProps: TradeCardProps;
  title: string;
  description: string;
  symbol: string;
  venueLabel: string;
  sideLabel: string;
  pnlLabel: string;
  pnlPercent: string;
  pnlTone: "up" | "down";
  entryLabel: string;
  exitLabel: string;
};

export async function getTradeShareData(
  positionId: string,
  store: CassieStore = new DrizzleCassieStore(),
): Promise<TradeShareData> {
  const position = await store.getPosition(positionId);
  if (!position) throw new TradeShareNotFoundError(positionId);

  const ticket = await store.getTradeTicket(position.ticketId);
  if (!ticket) throw new Error(`Trade ticket ${position.ticketId} was not found.`);

  const [run, steps, review] = await Promise.all([
    ticket.runId ? store.getRun(ticket.runId) : Promise.resolve(undefined),
    ticket.runId ? store.getRunSteps(ticket.runId) : Promise.resolve([]),
    store.getLatestPositionReview(position.positionId),
  ]);
  const thesisDetails = deriveTradeCardThesisDetails({ run, steps, ticket });

  return positionToTradeShareData({ position, ticket, run, steps, review, thesisDetails });
}

export function positionToTradeShareData(input: {
  position: Position;
  ticket: TradeTicket;
  run?: ControlRun;
  steps?: RunStep[];
  review?: PositionReview;
  thesisDetails: TradeCardThesisDetails;
}): TradeShareData {
  const { position, ticket, run, review, thesisDetails } = input;
  const steps = input.steps ?? [];
  const symbol = positionSymbol(position, ticket);
  const venueLabel = venueName(position.venue);
  const sideLabel = sideName(position.side);
  const pnlLabel = position.status === "closed" ? "Realized PnL" : "Unrealized PnL";
  const pnlPercent = formatSignedPct(position.unrealizedPnlPct);
  const pnlTone = position.unrealizedPnlPct < 0 ? "down" : "up";
  const entryLabel = formatPrice(position.entryPrice, position.venue);
  const exitLabel = formatPrice(position.currentMarkPrice ?? position.entryPrice, position.venue);
  const headline = run?.sourcePost.text.trim() || ticket.thesis;
  const authorHandle = run?.sourcePost.authorHandle?.trim();
  const authorName = run?.sourcePost.authorName?.trim();
  const authorLabel = authorHandle ? `@${authorHandle.replace(/^@/u, "")}` : authorName || "Cassie trade";
  const marketQuestion = marketQuestionFromTicket(ticket, position, symbol);

  const cardProps: TradeCardProps = {
    author: {
      name: authorLabel,
      date: formatShortDate(run?.sourcePost.createdAt ?? position.openedAt),
    },
    headline,
    thesis: [
      { label: "Signal", text: thesisDetails.signal },
      { label: "Why", text: thesisDetails.why },
      { label: "Invalidation", text: thesisDetails.invalidation },
    ],
    points: tradeTrendPoints(position.unrealizedPnlPct),
    pnl: {
      label: pnlLabel,
      percent: pnlPercent,
      side: sideLabel,
      when: position.status === "closed" && position.closedAt ? "closed" : ageLabel(position.openedAt),
      entry: entryLabel,
      exit: exitLabel,
    },
    market: {
      venue: venueLabel,
      question: marketQuestion,
      side: sideLabel,
      entry: entryLabel,
      exit: exitLabel,
      logoUrl: venueLogo(position.venue),
    },
    variant: "band",
  };

  return {
    position,
    ticket,
    run,
    steps,
    review,
    thesisDetails,
    cardProps,
    title: `${symbol} ${sideLabel} ${pnlPercent}`,
    description: review?.summary ?? ticket.thesis,
    symbol,
    venueLabel,
    sideLabel,
    pnlLabel,
    pnlPercent,
    pnlTone,
    entryLabel,
    exitLabel,
  };
}

export function deriveTradeCardThesisDetails(input: {
  run?: ControlRun;
  steps: RunStep[];
  ticket: TradeTicket;
}): TradeCardThesisDetails {
  return {
    signal: compactPublicLine(
      stepOutputString(input.steps, "intake", "headlineThesis")
      ?? stepOutputString(input.steps, "opportunity", "literalClaim")
      ?? input.run?.sourcePost.text
      ?? input.ticket.thesis,
      92,
    ),
    why: compactPublicLine(
      input.ticket.exitPlan.thesis
      ?? stepOutputString(input.steps, "trade_expression", "coreInterpretation")
      ?? stepOutputString(input.steps, "opportunity", "marketImplication")
      ?? input.ticket.thesis,
      78,
    ),
    invalidation: compactPublicLine(
      input.ticket.exitPlan.invalidationSignals[0]
      ?? input.ticket.thesis,
      72,
    ),
  };
}

function stepOutputString(steps: RunStep[], stepType: RunStep["stepType"], key: string) {
  for (const step of steps) {
    if (step.stepType !== stepType || !isRecord(step.output)) continue;
    const value = step.output[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactPublicLine(value: string, maxLength: number) {
  const clean = value
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (clean.length <= maxLength) return clean;

  const sentenceEnd = clean.search(/[.!?]\s/u);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= maxLength) {
    return clean.slice(0, sentenceEnd + 1).trim();
  }

  return `${clean.slice(0, maxLength - 3).trim()}...`;
}

function marketQuestionFromTicket(ticket: TradeTicket, position: Position, symbol: string) {
  if (position.venue === "hyperliquid") return `${symbol}-PERP`;
  return ticket.thesis;
}

function positionSymbol(position: Position, ticket: TradeTicket) {
  const ticketSymbol = ticket.venueData?.symbol?.trim();
  if (ticketSymbol) return ticketSymbol;
  return position.instrument
    .replace(/-PERP$/u, "")
    .replace(/^spot$/u, position.venue.toUpperCase());
}

function venueName(venue: string) {
  if (venue === "hyperliquid") return "Hyperliquid";
  if (venue === "polymarket") return "Polymarket";
  return venue.replace(/(^|[_-])([a-z])/giu, (_match, prefix: string, char: string) =>
    `${prefix === "_" || prefix === "-" ? " " : prefix}${char.toUpperCase()}`
  );
}

function venueLogo(venue: string) {
  if (venue === "hyperliquid") return "/hyperliquid-logo.png";
  if (venue === "polymarket") return "/polymarket-logo.png";
  return undefined;
}

function sideName(side: string) {
  if (side === "buy_yes") return "YES";
  if (side === "buy_no") return "NO";
  return side.toUpperCase();
}

function formatPrice(value: number | null, venue: string) {
  if (value == null) return "No mark";
  if (venue === "polymarket" || value <= 1) return `${Math.round(value * 100)}c`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatSignedPct(value: number) {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Cassie trade";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ageLabel(value: string) {
  const opened = new Date(value).valueOf();
  if (!Number.isFinite(opened)) return "open";
  const elapsedMs = Math.max(0, Date.now() - opened);
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  if (elapsedDays >= 7) return `${Math.floor(elapsedDays / 7)} wk ago`;
  if (elapsedDays >= 1) return `${elapsedDays}d ago`;
  const elapsedHours = Math.floor(elapsedMs / 3_600_000);
  if (elapsedHours >= 1) return `${elapsedHours}h ago`;
  return "now";
}

function tradeTrendPoints(pnlPct: number): TradeCardPoint[] {
  const positive = pnlPct >= 0;
  const yStart = positive ? 690 : 250;
  const yEnd = positive ? 180 : 720;
  const amp = positive ? 34 : 28;
  let seed = Math.max(7, Math.round(Math.abs(pnlPct) * 10));
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  return Array.from({ length: 120 }, (_, index) => {
    const t = index / 119;
    const trend = yStart + (yEnd - yStart) * t;
    const wobble =
      Math.sin(t * 13 + seed) * amp +
      Math.sin(t * 37 + seed * 2) * amp * 0.45 +
      (rand() - 0.5) * amp;
    return {
      x: 95 + (1565 - 95) * t,
      y: trend + wobble,
      label: "",
    };
  });
}
