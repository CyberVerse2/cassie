import type { CassieStore } from "../../../../../packages/core/db/store.ts";
import {
  SupervisorFinalResultSchema,
  type ControlRun,
} from "../../../../../packages/core/schemas/index.ts";
import { liveRunStages, truncate, type LiveStage } from "./run-stages.ts";
import { cleanSourceText } from "./source-text.ts";

// How long a finished run stays on the dashboard so a user returning from X
// still sees what happened to their tag.
const RECENT_WINDOW_MS = 15 * 60_000;
const RUN_SCAN_LIMIT = 8;

export type LiveRun = {
  runId: string;
  status: "running" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
  source: {
    authorHandle: string | null;
    authorName: string | null;
    text: string;
    url: string | null;
    mediaUrl: string | null;
  };
  stages: LiveStage[];
  outcome: {
    kind: "trade" | "no_trade" | "failed";
    summary: string | null;
    positionId: string | null;
    ticket: {
      side: string;
      instrument: string;
      venue: string;
      sizeUsd: number;
    } | null;
  } | null;
};

export type LiveRunsPayload = { runs: LiveRun[] };

// The user's in-flight pipeline runs plus anything that resolved in the last
// few minutes — what "did my tag work?" looks like when they come back from X.
export async function buildLiveRuns(
  store: CassieStore,
  userId: string,
): Promise<LiveRunsPayload> {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const runs = (await store.listUserRuns(userId, { limit: RUN_SCAN_LIMIT }))
    .filter(
      (run) =>
        run.status === "queued" ||
        run.status === "running" ||
        Date.parse(run.updatedAt) > cutoff,
    );
  if (runs.length === 0) return { runs: [] };

  const positions = await store.listUserPositions(userId);
  const positionByTicketId = new Map(
    positions.map((position) => [position.ticketId, position]),
  );

  const liveRuns = await Promise.all(
    runs.map(async (run) => {
      const active = run.status === "queued" || run.status === "running";
      const steps = await store.getRunSteps(run.runId);
      const source = run.sourcePost;
      const outcome = active
        ? null
        : await runOutcome(store, run, positionByTicketId);
      return {
        runId: run.runId,
        status: active
          ? ("running" as const)
          : run.status === "succeeded"
            ? ("done" as const)
            : ("failed" as const),
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        source: {
          authorHandle: source.authorHandle,
          authorName: source.authorName,
          text: source.text ? truncate(cleanSourceText(source.text), 180) : "",
          url: source.url,
          mediaUrl: source.mediaUrls?.[0] ?? null,
        },
        stages: liveRunStages(steps, active),
        outcome,
      } satisfies LiveRun;
    }),
  );
  return { runs: liveRuns };
}

async function runOutcome(
  store: CassieStore,
  run: ControlRun,
  positionByTicketId: Map<string, { positionId: string }>,
): Promise<LiveRun["outcome"]> {
  if (run.status !== "succeeded") {
    return {
      kind: "failed",
      summary: run.error ? truncate(run.error, 200) : null,
      positionId: null,
      ticket: null,
    };
  }
  const parsed = SupervisorFinalResultSchema.safeParse(run.result);
  const result = parsed.success ? parsed.data : null;
  const summary = result?.publicSummary
    ? truncate(result.publicSummary, 220)
    : null;
  if (!result?.ticketId) {
    return { kind: "no_trade", summary, positionId: null, ticket: null };
  }
  const ticket = await store.getTradeTicket(result.ticketId);
  return {
    kind: "trade",
    summary,
    positionId: positionByTicketId.get(result.ticketId)?.positionId ?? null,
    ticket: ticket
      ? {
          side: ticket.side,
          instrument: ticket.venueData?.symbol ?? ticket.instrument,
          venue: ticket.venue,
          sizeUsd: ticket.sizeUsd,
        }
      : null,
  };
}
