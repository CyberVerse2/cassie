import { DrizzleCassieStore } from "../../../../packages/core/db/drizzle-store.ts";
import type { CassieStore } from "../../../../packages/core/db/store.ts";
import type { ControlRun, Position, PositionReview, RunStep, TradeTicket, UserSettings } from "../../../../packages/core/schemas/index.ts";

type TradeCardPerson = {
  name: string;
  avatarUrl?: string;
};

export type TradeCardProps = {
  author?: TradeCardPerson;
  trader?: TradeCardPerson;
  headline?: string;
  why?: string;
  tradeResult?: {
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
    logoUrl?: string;
  };
};

export type TradeCardCopy = {
  headline: string;
  why: string;
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
  trader: TradeCardPerson;
  copy: TradeCardCopy;
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

export type TradeCardRenderData = {
  cardProps: TradeCardProps;
};

export async function getTradeShareData(
  positionId: string,
  store: CassieStore = new DrizzleCassieStore(),
): Promise<TradeShareData> {
  return positionToTradeShareData(await readTradeShareSource(positionId, store, { includeReview: true }));
}

export async function getTradeCardRenderData(
  positionId: string,
  store: CassieStore = new DrizzleCassieStore(),
): Promise<TradeCardRenderData> {
  const share = positionToTradeShareData(await readTradeShareSource(positionId, store, { includeReview: false }));
  return { cardProps: share.cardProps };
}

async function readTradeShareSource(
  positionId: string,
  store: CassieStore,
  options: { includeReview: boolean },
) {
  const position = await store.getPosition(positionId);
  if (!position) throw new TradeShareNotFoundError(positionId);

  const ticket = await store.getTradeTicket(position.ticketId);
  if (!ticket) throw new Error(`Trade ticket ${position.ticketId} was not found.`);

  const [run, steps, review, settings] = await Promise.all([
    ticket.runId ? store.getRun(ticket.runId) : Promise.resolve(undefined),
    ticket.runId ? store.getRunSteps(ticket.runId) : Promise.resolve([]),
    options.includeReview ? store.getLatestPositionReview(position.positionId) : Promise.resolve(undefined),
    store.getUserSettings(position.userId),
  ]);
  if (!settings) throw new Error(`Cassie user settings ${position.userId} were not found.`);
  const copy = deriveTradeCardCopy({ run, steps, ticket });
  const trader = traderFromSettings(settings);

  return { position, ticket, run, steps, review, trader, copy };
}

export function positionToTradeShareData(input: {
  position: Position;
  ticket: TradeTicket;
  run?: ControlRun;
  steps?: RunStep[];
  review?: PositionReview;
  trader: TradeCardPerson;
  copy: TradeCardCopy;
}): TradeShareData {
  const { position, ticket, run, review, trader, copy } = input;
  const steps = input.steps ?? [];
  const symbol = positionSymbol(position, ticket);
  const venueLabel = venueName(position.venue);
  const sideLabel = sideName(position.side);
  const pnlLabel = position.status === "closed" ? "Realized PnL" : "Unrealized PnL";
  const pnlPercent = formatSignedPct(position.unrealizedPnlPct);
  const pnlTone = position.unrealizedPnlPct < 0 ? "down" : "up";
  const entryLabel = formatPrice(position.entryPrice, position.venue);
  const exitLabel = formatPrice(position.currentMarkPrice ?? position.entryPrice, position.venue);
  const authorHandle = run?.sourcePost.authorHandle?.trim().replace(/^@/u, "");
  const authorName = run?.sourcePost.authorName?.trim();
  const authorLabel = authorHandle ? `@${authorHandle}` : authorName || "Cassie trade";
  const marketQuestion = marketQuestionFromTicket(ticket, position, symbol);

  const cardProps: TradeCardProps = {
    author: {
      name: authorLabel,
      avatarUrl: authorHandle ? `https://unavatar.io/x/${authorHandle}` : undefined,
    },
    trader,
    headline: copy.headline,
    why: copy.why,
    tradeResult: {
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
      logoUrl: venueLogo(position.venue),
    },
  };

  return {
    position,
    ticket,
    run,
    steps,
    review,
    trader,
    copy,
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

function traderFromSettings(settings: UserSettings): TradeCardPerson {
  return {
    name: settings.profile.name,
    avatarUrl: settings.profile.avatarUrl ?? undefined,
  };
}

export function deriveTradeCardCopy(input: {
  run?: ControlRun;
  steps: RunStep[];
  ticket: TradeTicket;
}): TradeCardCopy {
  return {
    headline: compactPublicLine(
      input.run?.sourcePost.text
      ?? input.ticket.exitPlan.thesis
      ?? input.ticket.thesis,
      92,
    ),
    why: compactPublicLine(
      input.ticket.exitPlan.thesis
      ?? input.ticket.thesis,
      78,
    ),
  };
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
  if (venue === "polymarket" || value <= 1) {
    return `${(value * 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}c`;
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedPct(value: number) {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
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
