"use client";

import { useEffect, useMemo, useState } from "react";

import c from "./promo-celebration.module.css";

// The moment the starter USDC lands. Renders client-side only, after a
// successful claim, so per-render randomness can't cause hydration drift.
export function PromoCelebration({
  amountUsd,
  onDismiss,
}: {
  amountUsd: number;
  onDismiss: () => void;
}) {
  const [shownUsd, setShownUsd] = useState(0);

  // Count the balance up from zero once the overlay settles.
  useEffect(() => {
    const startAt = performance.now() + 350;
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
  }, [amountUsd]);

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
      aria-label="Starter funds received"
    >
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

      <div className={c.card}>
        <span className={c.kicker}>Starter funds landed</span>
        <span className={c.amount}>
          $
          {shownUsd.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
        <h2 className={c.headline}>You’re staked.</h2>
        <p className={c.body}>
          The house just put ${amountUsd} of USDC in your account. Tag{" "}
          <strong>@cassiedottrade</strong> under any take on X — she trades it
          from here.
        </p>
        <button type="button" className={c.cta} onClick={onDismiss}>
          Make your first call →
        </button>
      </div>
    </div>
  );
}
