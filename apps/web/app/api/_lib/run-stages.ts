import type { RunStep } from "../../../../../packages/core/schemas/index.ts";
import type { ReplayStage } from "../../components/first-call-data.ts";

// Turns a run's persisted pipeline steps into human-readable stages. Shared
// by the first-call intro (replaying finished winners) and the live run card
// (streaming a run as it executes).

export const STAGE_PACING_MS = 1800;

// Labels for steps that are still running (no output to summarize yet).
const STEP_LABELS: Record<string, string> = {
  intake: "Reading the post",
  preflight: "Checking your account",
  context_discovery: "Searching X for context",
  opportunity: "Framing the opportunity",
  trade_expression: "Choosing the expression",
  market_candidates: "Searching venues",
  market_assessment: "Assessing fit",
  market_quote: "Fetching quotes",
  market_selection: "Quote & selection",
  ticket: "Cutting the ticket",
  final: "Wrapping up",
};

export type LiveStage = {
  stepType: string;
  label: string;
  body: string | null;
  state: "done" | "running";
};

export function stagesFromRunSteps(steps: RunStep[]): ReplayStage[] {
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

// The live view: everything completed so far plus the step in flight. When
// the run is active but between steps, a generic "working" stage keeps the
// card visibly alive.
export function liveRunStages(steps: RunStep[], runActive: boolean): LiveStage[] {
  const stages: LiveStage[] = stagesFromRunSteps(steps).map((stage) => ({
    stepType: stage.stepType,
    label: stage.label,
    body: stage.body,
    state: "done" as const,
  }));

  const running = steps
    .filter((step) => step.status === "running")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))[0];
  if (running) {
    stages.push({
      stepType: running.stepType,
      label: STEP_LABELS[running.stepType] ?? "Working",
      body: null,
      state: "running",
    });
  } else if (runActive) {
    stages.push({
      stepType: "working",
      label: stages.length === 0 ? "Picking up your tag" : "Thinking",
      body: null,
      state: "running",
    });
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

export function bareSymbol(symbol: string): string {
  const bare = symbol.includes(":")
    ? symbol.slice(symbol.indexOf(":") + 1)
    : symbol;
  return bare.replace(/-PERP$/iu, "").toUpperCase();
}

export function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const cutoff = cleaned.lastIndexOf(" ", max);
  return `${cleaned.slice(0, cutoff > max * 0.6 ? cutoff : max).trim()}…`;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
