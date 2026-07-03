"use client";

import { useEffect, useMemo, useState } from "react";

import c from "./promo-celebration.module.css";

export type PromoCelebrationState =
  | { status: "sending" }
  | { status: "landed"; amountUsd: number }
  | { status: "failed"; message: string };

// The moment the starter USDC lands. Opens instantly in a "sending" state the
// tick the user clicks claim, then erupts when the transfer confirms — the
// on-chain wait reads as anticipation instead of a dead button.
export function PromoCelebration({
  state,
  onDismiss,
}: {
  state: PromoCelebrationState;
  onDismiss: () => void;
}) {
  const landed = state.status === "landed";
  const amountUsd = landed ? state.amountUsd : 10;
  const [shownUsd, setShownUsd] = useState(0);

  // Count the balance up from zero once the money is actually there.
  useEffect(() => {
    if (!landed) return;
    const startAt = performance.now() + 250;
    const durationMs = 1400;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(Math.max((now - startAt) / durationMs, 0), 1);
      const eased = 1 - (1 - progress) ** 3;
      setShownUsd(amountUsd * eased);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [landed, amountUsd]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: `${(i * 37 + Math.random() * 20) % 100}%`,
        delay: `${(Math.random() * 900).toFixed(0)}ms`,
        duration: `${(2200 + Math.random() * 1800).toFixed(0)}ms`,
        size: 5 + Math.random() * 5,
        spin: Math.random() > 0.5 ? c.confettiSpinA : c.confettiSpinB,
      })),
    [],
  );

  return (
    <div
      className={c.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Starter funds"
    >
      {landed && (
        <div className={c.rain} aria-hidden>
          {confetti.map((piece, i) => (
            <span
              key={i}
              className={`${c.confetti} ${piece.spin}`}
              style={{
                left: piece.left,
                width: piece.size,
                height: piece.size * 1.6,
                animationDelay: piece.delay,
                animationDuration: piece.duration,
              }}
            />
          ))}
        </div>
      )}

      <div className={c.card}>
        {state.status === "failed" ? (
          <>
            <span className={c.kicker}>Starter funds</span>
            <h2 className={c.headline}>That didn’t land.</h2>
            <p className={c.body}>{state.message}</p>
            <p className={c.body}>
              Your claim is still available — try again from the panel on the
              left.
            </p>
            <button type="button" className={c.cta} onClick={onDismiss}>
              Close
            </button>
          </>
        ) : (
          <>
            <span className={c.kicker}>
              {landed ? "Starter funds landed" : "Starter funds"}
            </span>
            <span className={`${c.amount} ${landed ? "" : c.amountPending}`}>
              $
              {(landed ? shownUsd : amountUsd).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            {landed ? (
              <>
                <h2 className={c.headline}>You’re staked.</h2>
                <p className={c.body}>
                  The house just put ${amountUsd} of USDC in your account. Tag{" "}
                  <strong>@cassiedottrade</strong> under any take on X — she
                  trades it from here.
                </p>
                <button type="button" className={c.cta} onClick={onDismiss}>
                  Make your first call →
                </button>
              </>
            ) : (
              <>
                <h2 className={c.headline}>On its way.</h2>
                <p className={c.body}>
                  Wiring your stake from the house wallet — a few seconds while
                  the chain confirms.
                </p>
                <span className={c.sendingRow} aria-hidden>
                  <span className={c.sendingSpinner} />
                  Sending USDC…
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
