"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  FIRST_CALL_PROMPT,
  firstCallScenarios,
  type FirstCallScenario,
} from "./first-call-data";
import c from "./first-call.module.css";

async function fetchLiveScenarios(): Promise<FirstCallScenario[]> {
  const response = await fetch("/api/first-call");
  if (!response.ok) throw new Error("first-call scenarios unavailable");
  const payload = (await response.json()) as {
    scenarios?: FirstCallScenario[];
  };
  return payload.scenarios ?? [];
}

type Phase = "compose" | "run" | "done";

// Loose on purpose: this is a nudge, not a typing test.
function replyTriggers(text: string): boolean {
  return /@?cassie|trade|watch|critic/iu.test(text);
}

export function FirstCall({
  userProfile,
  onDismiss,
  onTour,
  promoAvailable,
  onClaimPromo,
}: {
  userProfile: {
    name: string;
    handle: string;
    avatarUrl: string | null;
    initial: string;
  } | null;
  onDismiss: () => void;
  onTour: () => void;
  promoAvailable: boolean;
  onClaimPromo: () => void;
}) {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("compose");
  const [reply, setReply] = useState("");
  const [nudge, setNudge] = useState(false);
  // Index of the stage currently "running"; stages below it are complete.
  const [stageIdx, setStageIdx] = useState(0);
  const [autoTyping, setAutoTyping] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  // The book's best closed winners, replayed from their real pipeline runs.
  // Until they load (or if there are none yet), the authored scenarios stand in.
  const liveQuery = useQuery({
    queryKey: ["first-call-scenarios"],
    queryFn: fetchLiveScenarios,
    staleTime: 5 * 60_000,
  });
  const scenarios = useMemo(
    () =>
      liveQuery.data && liveQuery.data.length > 0
        ? liveQuery.data
        : firstCallScenarios,
    [liveQuery.data],
  );

  const composeScenario = useMemo(
    () =>
      scenarios.find((entry) => entry.id === scenarioId) ?? scenarios[0],
    [scenarios, scenarioId],
  );
  // Frozen at submit so a late-arriving live payload can't swap the scenario
  // mid-replay.
  const [runScenario, setRunScenario] = useState<FirstCallScenario | null>(
    null,
  );
  const scenario =
    phase === "compose" ? composeScenario : (runScenario ?? composeScenario);

  useEffect(() => {
    if (phase === "compose") inputRef.current?.focus();
  }, [phase, scenarioId]);

  // Advance the replay one stage at a time on the authored pacing.
  useEffect(() => {
    if (phase !== "run") return;
    if (stageIdx >= scenario.stages.length) {
      setPhase("done");
      return;
    }
    const timer = window.setTimeout(
      () => setStageIdx((idx) => idx + 1),
      scenario.stages[stageIdx].ms,
    );
    return () => window.clearTimeout(timer);
  }, [phase, stageIdx, scenario]);

  // Keep the newest stage in view as the tape prints.
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [stageIdx, phase]);

  useEffect(() => {
    if (!autoTyping) return;
    const interval = window.setInterval(() => {
      setReply((current) => {
        if (current.length >= FIRST_CALL_PROMPT.length) {
          setAutoTyping(false);
          return current;
        }
        return FIRST_CALL_PROMPT.slice(0, current.length + 1);
      });
    }, 45);
    return () => window.clearInterval(interval);
  }, [autoTyping]);

  function pickScenario(next: FirstCallScenario) {
    if (next.id === scenario.id) return;
    setScenarioId(next.id);
    setRunScenario(null);
    setPhase("compose");
    setReply("");
    setStageIdx(0);
    setAutoTyping(false);
  }

  function submitReply() {
    if (phase !== "compose") return;
    if (!replyTriggers(reply)) {
      setNudge(true);
      window.setTimeout(() => setNudge(false), 700);
      return;
    }
    setAutoTyping(false);
    setRunScenario(composeScenario);
    setStageIdx(0);
    setPhase("run");
  }

  function skipToResult() {
    setStageIdx(scenario.stages.length);
    setPhase("done");
  }

  const replyReady = replyTriggers(reply);
  const up = scenario.result.pnlPct >= 0;

  return (
    <div className={c.overlay} role="dialog" aria-modal="true" aria-label="How Cassie works">
      <div className={c.frame}>
        <header className={c.top}>
          <div>
            <span className={c.kicker}>Your first trade</span>
            <h2 className={c.headline}>Tag her under a take. She does the rest.</h2>
          </div>
          <button type="button" className={c.skip} onClick={onDismiss}>
            Skip intro
          </button>
        </header>

        <div className={c.panes}>
          <section className={c.postPane}>
            <div className={c.chips} role="tablist" aria-label="Pick a post">
              {scenarios.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === scenario.id}
                  className={`${c.chip} ${entry.id === scenario.id ? c.chipActive : ""}`}
                  onClick={() => pickScenario(entry)}
                >
                  {entry.handle}
                </button>
              ))}
            </div>

            <article className={c.post}>
              <header className={c.postHead}>
                <img className={c.postAvatar} src={scenario.avatarUrl} alt="" aria-hidden />
                <div className={c.postId}>
                  <span className={c.postName}>{scenario.authorName}</span>
                  <span className={c.postMeta}>
                    {scenario.handle} · {scenario.date}
                  </span>
                </div>
              </header>
              <p className={c.postBody}>{scenario.text}</p>
              {scenario.mediaUrls?.[0] && (
                <img
                  className={c.postMedia}
                  src={scenario.mediaUrls[0]}
                  alt=""
                  loading="lazy"
                />
              )}
            </article>

            {phase === "compose" ? (
              <div className={`${c.composer} ${nudge ? c.composerNudge : ""}`}>
                <div className={c.composerRow}>
                  {userProfile?.avatarUrl ? (
                    <img className={c.composerAvatar} src={userProfile.avatarUrl} alt="" aria-hidden />
                  ) : (
                    <span className={c.composerAvatar} aria-hidden>
                      {userProfile?.initial ?? "•"}
                    </span>
                  )}
                  <textarea
                    ref={inputRef}
                    className={c.composerInput}
                    rows={1}
                    value={reply}
                    placeholder={`Reply to ${scenario.handle}…`}
                    onChange={(event) => setReply(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        submitReply();
                      }
                    }}
                  />
                </div>
                <div className={c.composerFoot}>
                  <span className={`${c.hint} ${replyReady ? c.hintReady : ""}`}>
                    {replyReady ? (
                      <>That’s it — post it</>
                    ) : (
                      <>
                        Type <code>{FIRST_CALL_PROMPT}</code>
                      </>
                    )}
                  </span>
                  <div className={c.composerActions}>
                    <button
                      type="button"
                      className={c.autoType}
                      onClick={() => {
                        setReply("");
                        setAutoTyping(true);
                      }}
                      disabled={autoTyping}
                    >
                      Type it for me
                    </button>
                    <button
                      type="button"
                      className={c.postReply}
                      onClick={submitReply}
                    >
                      Reply ↵
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className={c.sentReply}>
                <span className={c.sentLabel}>Your reply</span>
                <p className={c.sentBody}>
                  <span className={c.mention}>@cassiedottrade</span>{" "}
                  {reply.replace(/@?cassiedottrade/iu, "").trim() || "trade this"}
                </p>
              </div>
            )}
          </section>

          <section className={c.pipePane}>
            <header className={c.pipeHead}>
              <span className={c.pipeTitle}>watch cassie work</span>
            </header>

            <div className={c.pipeFeed} ref={feedRef}>
              {phase === "compose" ? (
                <div className={c.pipeIdle}>
                  Cassie is watching the timeline. Post your reply and the run
                  starts — the same pipeline that trades from a real mention.
                </div>
              ) : (
                <>
                  {scenario.stages.map((stage, idx) => {
                    if (phase === "run" && idx > stageIdx) return null;
                    const running = phase === "run" && idx === stageIdx;
                    return (
                      <div
                        key={stage.stepType + idx}
                        className={`${c.stage} ${running ? c.stageRunning : c.stageDone}`}
                      >
                        <span className={c.stageMark} aria-hidden>
                          {running ? <span className={c.spinner} /> : "✓"}
                        </span>
                        <div className={c.stageText}>
                          <span className={c.stageLabel}>{stage.label}</span>
                          {!running && <p className={c.stageBody}>{stage.body}</p>}
                        </div>
                      </div>
                    );
                  })}

                  {phase === "done" && (
                    <div className={c.result}>
                      <span className={c.resultKicker}>Trade ticket</span>
                      <div className={c.resultHead}>
                        <span className={`${c.resultSide} ${up ? c.pnlUp : c.pnlDown}`}>
                          {scenario.result.side}
                        </span>
                        <span className={c.resultSymbol}>{scenario.result.symbol}</span>
                        <span className={c.resultVenue}>{scenario.result.venue}</span>
                      </div>
                      <p className={c.resultDetail}>{scenario.result.detail}</p>
                      <p className={c.resultThesis}>“{scenario.result.thesis}”</p>
                      <div className={c.resultOutcome}>
                        <span>
                          {scenario.result.entry} → {scenario.result.exit}
                        </span>
                        <span className={`${c.pnlChip} ${up ? c.pnlUp : c.pnlDown}`}>
                          {up ? "+" : ""}
                          {scenario.result.pnlPct.toFixed(1)}% in {scenario.result.holdDays}d
                        </span>
                      </div>
                      <div className={c.resultCtas}>
                        {promoAvailable ? (
                          <button
                            type="button"
                            className={c.ctaPrimary}
                            onClick={onClaimPromo}
                          >
                            Claim $10 &amp; start trading →
                          </button>
                        ) : (
                          <button type="button" className={c.ctaPrimary} onClick={onDismiss}>
                            Fund my account →
                          </button>
                        )}
                        <button type="button" className={c.ctaGhost} onClick={onTour}>
                          Show me around first
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {phase === "run" && (
              <button type="button" className={c.skipRun} onClick={skipToResult}>
                Skip to the result
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
