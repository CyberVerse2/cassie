"use client";

import { useEffect, useMemo, useState } from "react";

import c from "./dashboard-tour.module.css";

// Coach-mark tour over the live dashboard. Steps anchor to data-tour
// attributes; any target missing from the current layout is skipped.
const TOUR_STEPS = [
  {
    target: "balance",
    title: "Your balance",
    body: "Cassie trades with the USDC you hold here. Deposit from any supported chain — the QR below is your address.",
  },
  {
    target: "size",
    title: "Default trade size",
    body: "Every call risks this much unless you say otherwise in your reply. Start small; raise it when she earns it.",
  },
  {
    target: "portfolio",
    title: "Your portfolio",
    body: "Positions Cassie opens for you land here with live P/L. Close or share any of them whenever you like.",
  },
  {
    target: "tape",
    title: "The tape",
    body: "Every call anyone makes on Cassie, most profitable first. Tag @cassiedottrade under a take on X and yours prints here.",
  },
] as const;

type TargetRect = { top: number; left: number; width: number; height: number };

export function DashboardTour({ onClose }: { onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);

  // Only tour what is actually on screen for this user.
  const steps = useMemo(
    () =>
      TOUR_STEPS.filter((step) =>
        document.querySelector(`[data-tour="${step.target}"]`),
      ),
    [],
  );
  const step = steps[idx];

  useEffect(() => {
    if (!step) return;
    const element = document.querySelector(`[data-tour="${step.target}"]`);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });

    let frame = 0;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setRect({
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      });
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" || event.key === "Enter") {
        setIdx((current) => Math.min(current + 1, steps.length - 1));
      }
      if (event.key === "ArrowLeft") {
        setIdx((current) => Math.max(current - 1, 0));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  if (!step || !rect) return null;

  const last = idx === steps.length - 1;
  const pad = 8;
  const cardWidth = 300;
  const cardEstHeight = 220;
  const clampX = (value: number) =>
    Math.min(Math.max(value, 16), Math.max(16, window.innerWidth - cardWidth - 16));

  // Below the target when there's room, above when there isn't, and beside
  // it for full-height targets (the tape column) where neither fits.
  const below =
    rect.top + rect.height + cardEstHeight + 24 < window.innerHeight;
  const above = !below && rect.top > cardEstHeight + 24;
  let cardTop: number;
  let cardLeft: number;
  let cardTransform: string | undefined;
  if (below) {
    cardTop = rect.top + rect.height + pad + 12;
    cardLeft = clampX(rect.left);
  } else if (above) {
    cardTop = rect.top - pad - 12;
    cardTransform = "translateY(-100%)";
    cardLeft = clampX(rect.left);
  } else {
    cardTop = Math.max(
      16,
      Math.min(
        rect.top + rect.height / 2 - cardEstHeight / 2,
        window.innerHeight - cardEstHeight - 16,
      ),
    );
    const leftOfTarget = rect.left - cardWidth - 24;
    cardLeft =
      leftOfTarget >= 16
        ? leftOfTarget
        : clampX(rect.left + rect.width + 24);
  }

  return (
    <div className={c.tour} role="dialog" aria-modal="true" aria-label="Dashboard tour">
      <button
        type="button"
        className={c.scrim}
        onClick={onClose}
        aria-label="End tour"
      />
      <div
        className={c.ring}
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }}
        aria-hidden
      />
      <div
        className={c.card}
        style={{
          width: cardWidth,
          left: cardLeft,
          top: cardTop,
          transform: cardTransform,
        }}
      >
        <span className={c.count}>
          {idx + 1} / {steps.length}
        </span>
        <h3 className={c.title}>{step.title}</h3>
        <p className={c.body}>{step.body}</p>
        <div className={c.actions}>
          <button type="button" className={c.skip} onClick={onClose}>
            {last ? "" : "Skip tour"}
          </button>
          <div className={c.nav}>
            {idx > 0 && (
              <button
                type="button"
                className={c.back}
                onClick={() => setIdx(idx - 1)}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className={c.next}
              onClick={() => (last ? onClose() : setIdx(idx + 1))}
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
