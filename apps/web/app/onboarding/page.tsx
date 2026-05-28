"use client";

import { useState } from "react";
import { StyledQR } from "../components/styled-qr";
import { useCassieAccount } from "../lib/use-cassie-account";
import s from "./onboarding.module.css";

const steps = [
  { id: "welcome", label: "Welcome" },
  { id: "fund", label: "Fund" },
  { id: "defaults", label: "Defaults" },
  { id: "first", label: "First mention" },
] as const;

type StepId = (typeof steps)[number]["id"];

export default function OnboardingPage() {
  const [stepId, setStepId] = useState<StepId>("welcome");
  const account = useCassieAccount();
  const currentIndex = steps.findIndex((s) => s.id === stepId);
  const goto = (id: StepId) => setStepId(id);
  const next = () => {
    if (currentIndex < steps.length - 1) goto(steps[currentIndex + 1].id);
  };

  return (
    <main className={s.shell}>
      <div className={s.canvas} aria-hidden>
        <video
          className={s.video}
          src="/cassie-hero-loop.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
        <div className={s.vignette} />
        <div className={s.grain} />
      </div>

      <header className={s.topbar}>
        <a className={s.brand} href="/" aria-label="Cassie home">
          <img className={s.brandMark} src="/cassie-logo-transparent.png" alt="" aria-hidden />
        </a>
        <Stepper current={currentIndex} onJump={goto} />
      </header>

      <section className={s.frame} key={stepId}>
        {stepId === "welcome" && <StepWelcome onNext={next} login={account.login} authenticated={account.authenticated} />}
        {stepId === "fund" && (
          <StepFund
            onSkip={() => goto("defaults")}
            onNext={next}
            prepareAccount={account.prepareAccount}
            walletAddress={account.walletAddress}
            status={account.status}
            error={account.error}
          />
        )}
        {stepId === "defaults" && <StepDefaults onNext={next} syncAccount={account.prepareAccount} />}
        {stepId === "first" && <StepFirstMention />}
      </section>
    </main>
  );
}

function Stepper({
  current,
  onJump,
}: {
  current: number;
  onJump: (id: StepId) => void;
}) {
  return (
    <nav className={s.stepper} aria-label="Onboarding progress">
      {steps.map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "future";
        return (
          <button
            key={step.id}
            type="button"
            className={`${s.stepDot} ${s[`stepDot_${state}`]}`}
            onClick={() => i <= current && onJump(step.id)}
            disabled={i > current}
            aria-current={i === current ? "step" : undefined}
            aria-label={`Step ${i + 1}: ${step.label}`}
          >
            <span className={s.stepIndex}>{String(i + 1).padStart(2, "0")}</span>
            <span className={s.stepLabel}>{step.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function StepWelcome({
  onNext,
  login,
  authenticated,
}: {
  onNext: () => void;
  login: () => void;
  authenticated: boolean;
}) {
  return (
    <div className={s.step}>
      <span className={s.eyebrow}>You're in</span>
      <h1 className={s.display}>
        Welcome, <em>Celestine</em>.
      </h1>
      <p className={s.lede}>
        Mention me under any post — I'll find the best trade across{" "}
        <em>Hyperliquid</em>, <em>Polymarket</em>, and more.
      </p>
      <div className={s.ctaRow}>
        <button
          type="button"
          className={`${s.btn} ${s.btnPrimary}`}
          onClick={() => {
            if (!authenticated) {
              login();
              return;
            }
            onNext();
          }}
        >
          Begin
          <span className={s.arrow} aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

function StepFund({
  onSkip,
  onNext,
  prepareAccount,
  walletAddress,
  status,
  error,
}: {
  onSkip: () => void;
  onNext: () => void;
  prepareAccount: () => Promise<unknown>;
  walletAddress: string | null;
  status: "idle" | "loading" | "error";
  error: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const depositUri = walletAddress ? `ethereum:${walletAddress}@8453` : null;
  const short = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Creating wallet";

  async function copy() {
    if (!walletAddress) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    await window.navigator.clipboard.writeText(walletAddress);
  }

  async function continueAfterSetup() {
    const prepared = await prepareAccount();
    if (prepared) onNext();
  }

  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step two · Fund</span>
      <h1 className={s.display}>
        Send some <em>USDC</em>.
      </h1>
      <p className={s.lede}>
        Cassie trades from a Base wallet — minted only for you. Scan to deposit USDC, or copy the address.
      </p>

      <div className={s.fundCard}>
        <div className={s.qrWrap}>
          {depositUri ? <StyledQR data={depositUri} size={196} /> : <span className={s.fundLabel}>Wallet pending</span>}
        </div>
        <div className={s.fundMeta}>
          <span className={s.fundLabel}>Your Base wallet</span>
          <span className={s.fundAddress}>{short}</span>
          <button type="button" className={s.fundCopy} onClick={copy} disabled={!walletAddress}>
            {copied ? "Copied" : "Copy address"}
          </button>
          <span className={s.fundStatus}>
            <span className={s.fundPulse} aria-hidden />
            {error ?? "Watching for USDC on Base"}
          </span>
        </div>
      </div>

      <div className={s.ctaRow}>
        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onSkip}>
          I'll do this later
        </button>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={continueAfterSetup} disabled={status === "loading"}>
          {status === "loading" ? "Preparing" : "Continue"}
          <span className={s.arrow} aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

const presets = [25, 50, 100, 250];

function StepDefaults({
  onNext,
  syncAccount,
}: {
  onNext: () => void;
  syncAccount: (input?: { defaultTradeSizeUsd?: number }) => Promise<unknown>;
}) {
  const [value, setValue] = useState("50");

  async function save() {
    await syncAccount({ defaultTradeSizeUsd: Number(value) });
    onNext();
  }

  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step three · Defaults</span>
      <h1 className={s.display}>
        How much per <em>trade</em>?
      </h1>
      <p className={s.lede}>
        When you tag <span className={s.mention}>@cassie</span> trade this, I'll deploy this amount from your wallet.
      </p>

      <label className={s.amountField}>
        <span className={s.amountCurrency}>$</span>
        <input
          type="text"
          inputMode="decimal"
          className={s.amountInput}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label="Default trade size in USDC"
          autoFocus
        />
        <span className={s.amountSuffix}>USDC</span>
      </label>

      <div className={s.presetRow}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={`${s.preset} ${value === String(p) ? s.presetActive : ""}`}
            onClick={() => setValue(String(p))}
          >
            ${p}
          </button>
        ))}
      </div>

      <p className={s.fineprint}>
        Counter and watch inherit this size. You can change it later from the sidebar.
      </p>

      <div className={s.ctaRow}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={save}>
          Save & continue
          <span className={s.arrow} aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

function StepFirstMention() {
  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step four · Try it</span>
      <h1 className={s.display}>
        Now <em>mention me</em>.
      </h1>
      <p className={s.lede}>
        Under any market-flavoured tweet, reply with <span className={s.mention}>@cassie trade this</span>. I'll do the rest.
      </p>

      <div className={s.mockTweet}>
        <div className={s.mockHead}>
          <span className={s.mockAvatar}>M</span>
          <div className={s.mockId}>
            <span className={s.mockName}>maya</span>
            <span className={s.mockHandle}>@maya_trades · 11m</span>
          </div>
        </div>
        <p className={s.mockBody}>
          SOL ETF approval odds quietly grinding back above 60c on Polymarket. Volume's there, this is the one.
        </p>
        <div className={s.mockReply}>
          <span className={s.mockReplyMention}>@cassie</span> trade this
          <span className={s.caret} aria-hidden />
        </div>
      </div>

      <div className={s.ctaRow}>
        <a className={`${s.btn} ${s.btnGhost}`} href="/">
          Back to home
        </a>
        <a className={`${s.btn} ${s.btnPrimary}`} href="/dashboard">
          Open my dashboard
          <span className={s.arrow} aria-hidden>→</span>
        </a>
      </div>
    </div>
  );
}
