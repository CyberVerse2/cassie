"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { LiveRun, LiveRunsPayload } from "../api/_lib/live-runs";
import c from "./live-runs.module.css";

const dismissedKey = "cassie.dismissedRuns";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(dismissedKey);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-50) : [];
  } catch {
    return [];
  }
}

// Live pipeline cards: when the user tags @cassiedottrade on X and comes
// back, the run they just triggered is streaming here — the same stage
// language the intro taught them, but real and in flight.
export function LiveRuns({ enabled }: { enabled: boolean }) {
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const knownStatuses = useRef(new Map<string, LiveRun["status"]>());

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/runs/stream");
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as LiveRunsPayload;
        setRuns(payload.runs);
      } catch {
        // Skip malformed frames; the next snapshot replaces them.
      }
    };
    return () => source.close();
  }, [enabled]);

  // When a run resolves, the rest of the dashboard (positions, activity,
  // balance) must catch up.
  useEffect(() => {
    for (const run of runs) {
      const previous = knownStatuses.current.get(run.runId);
      if (previous === "running" && run.status !== "running") {
        void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        void queryClient.invalidateQueries({ queryKey: ["tape"] });
      }
      knownStatuses.current.set(run.runId, run.status);
    }
  }, [runs, queryClient]);

  function dismiss(runId: string) {
    const next = [...dismissed, runId].slice(-50);
    setDismissed(next);
    window.localStorage.setItem(dismissedKey, JSON.stringify(next));
  }

  const visible = runs.filter(
    (run) => run.status === "running" || !dismissed.includes(run.runId),
  );
  if (!enabled || visible.length === 0) return null;

  return (
    <div className={c.stack}>
      {visible.map((run) => (
        <LiveRunCard key={run.runId} run={run} onDismiss={() => dismiss(run.runId)} />
      ))}
    </div>
  );
}

function LiveRunCard({
  run,
  onDismiss,
}: {
  run: LiveRun;
  onDismiss: () => void;
}) {
  const running = run.status === "running";
  const stagesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const feed = stagesRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [run.stages.length]);

  return (
    <section
      className={`${c.card} ${running ? c.cardLive : ""}`}
      aria-live="polite"
    >
      <header className={c.head}>
        <span className={c.title}>
          {running ? (
            <>
              <span className={c.liveDot} aria-hidden />
              Cassie is on your tag
            </>
          ) : run.outcome?.kind === "trade" ? (
            "Call filled"
          ) : run.outcome?.kind === "no_trade" ? (
            "Cassie passed on this one"
          ) : (
            "That run didn’t make it"
          )}
        </span>
        {!running && (
          <button
            type="button"
            className={c.dismiss}
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </header>

      <div className={c.body}>
        <div className={c.source}>
          {run.source.authorHandle && (
            <span className={c.sourceauthor}>
              <img
                className={c.sourceAvatar}
                src={`https://unavatar.io/x/${run.source.authorHandle}`}
                alt=""
                aria-hidden
              />
              @{run.source.authorHandle}
            </span>
          )}
          <p className={c.sourceText}>{run.source.text}</p>
          {run.source.url && (
            <a
              className={c.sourceLink}
              href={run.source.url}
              target="_blank"
              rel="noreferrer"
            >
              View post ↗
            </a>
          )}
        </div>

        <div className={c.stages} ref={stagesRef}>
          {run.stages.map((stage, idx) => (
            <div
              key={stage.stepType + idx}
              className={`${c.stage} ${stage.state === "running" ? c.stageRunning : ""}`}
            >
              <span className={c.stageMark} aria-hidden>
                {stage.state === "running" ? (
                  <span className={c.spinner} />
                ) : (
                  "✓"
                )}
              </span>
              <div className={c.stageText}>
                <span className={c.stageLabel}>{stage.label}</span>
                {stage.body && <p className={c.stageBody}>{stage.body}</p>}
              </div>
            </div>
          ))}

          {run.outcome && (
            <div
              className={`${c.outcome} ${
                run.outcome.kind === "trade"
                  ? c.outcomeTrade
                  : run.outcome.kind === "failed"
                    ? c.outcomeFailed
                    : ""
              }`}
            >
              {run.outcome.kind === "trade" && run.outcome.ticket ? (
                <>
                  <span className={c.outcomeTicket}>
                    {run.outcome.ticket.side.toUpperCase()}{" "}
                    {bareInstrument(run.outcome.ticket.instrument)} · $
                    {Math.round(run.outcome.ticket.sizeUsd)} ·{" "}
                    {run.outcome.ticket.venue}
                  </span>
                  <span className={c.outcomeNote}>
                    Now live in your open positions below.
                  </span>
                </>
              ) : (
                <span className={c.outcomeNote}>
                  {run.outcome.summary ??
                    (run.outcome.kind === "failed"
                      ? "Something broke mid-run. Tag her again to retry."
                      : "No trade this time.")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function bareInstrument(instrument: string): string {
  const bare = instrument.includes(":")
    ? instrument.slice(instrument.indexOf(":") + 1)
    : instrument;
  return bare.replace(/-PERP$/iu, "").toUpperCase();
}
