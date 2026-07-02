"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StyledQR } from "../components/styled-qr";
import { useCassieAccount } from "../lib/use-cassie-account";
import s from "./onboarding.module.css";

const steps = [
  { id: "welcome", label: "Welcome" },
  { id: "permissions", label: "Permissions" },
  { id: "fund", label: "Fund" },
  { id: "defaults", label: "Defaults" },
  { id: "notify", label: "Notify" },
  { id: "first", label: "First mention" },
] as const;

type StepId = (typeof steps)[number]["id"];

export default function OnboardingPage() {
  const router = useRouter();
  const [stepId, setStepId] = useState<StepId>("welcome");
  const account = useCassieAccount();
  const currentIndex = steps.findIndex((s) => s.id === stepId);
  const goto = (id: StepId) => setStepId(id);
  const next = () => {
    if (currentIndex < steps.length - 1) goto(steps[currentIndex + 1].id);
  };

  useEffect(() => {
    if (account.ready && !account.authenticated) router.replace("/");
  }, [account.authenticated, account.ready, router]);

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
        {stepId === "welcome" && (
          <StepWelcome
            onNext={next}
            authenticated={account.authenticated}
            ready={account.ready}
            name={account.userProfile?.name ?? "there"}
          />
        )}
        {stepId === "permissions" && (
          <StepPermissions
            onNext={next}
            prepareAccount={account.prepareAccount}
            status={account.status}
            error={account.error}
          />
        )}
        {stepId === "fund" && (
          <StepFund
            onSkip={() => goto("defaults")}
            onNext={next}
            walletAddress={account.walletAddress}
            depositAddress={account.depositAddress}
            error={account.error}
          />
        )}
        {stepId === "defaults" && (
          <StepDefaults
            onNext={next}
            syncAccount={account.syncAccount}
            defaultTradeSizeUsd={account.account?.defaultTradeSizeUsd ?? 50}
          />
        )}
        {stepId === "notify" && (
          <StepNotify
            onSkip={() => goto("first")}
            onNext={next}
            telegram={account.account?.telegram ?? null}
            beginTelegramConnect={account.beginTelegramConnect}
            refreshAccount={account.refreshAccount}
          />
        )}
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
  authenticated,
  ready,
  name,
}: {
  onNext: () => void;
  authenticated: boolean;
  ready: boolean;
  name: string;
}) {
  const canBegin = ready && authenticated;

  return (
    <div className={s.step}>
      <span className={s.eyebrow}>You're in</span>
      <h1 className={s.display}>
        Welcome, <em>{name}</em>.
      </h1>
      <p className={s.lede}>
        Mention me under any post — I'll find the best trade across{" "}
        <em>Hyperliquid</em>, <em>Polymarket</em>, and more.
      </p>
      <div className={s.ctaRow}>
        <button
          type="button"
          className={`${s.btn} ${s.btnPrimary}`}
          onClick={onNext}
          disabled={!canBegin}
        >
          {ready ? "Begin" : "Checking session"}
          <span className={s.arrow} aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

function StepPermissions({
  onNext,
  prepareAccount,
  status,
  error,
}: {
  onNext: () => void;
  prepareAccount: () => Promise<unknown>;
  status: "idle" | "loading" | "error";
  error: string | null;
}) {
  async function enablePermission() {
    const prepared = await prepareAccount();
    if (prepared) onNext();
  }

  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step two · Permissions</span>
      <h1 className={s.display}>
        Let Cassie <em>trade</em> when it matters.
      </h1>
      <p className={s.lede}>
        Funds stay in your Privy wallet. This gives Cassie trading permission so a tweet, watch, or counter can execute without asking you to approve every single time.
      </p>
      <p className={s.fineprint}>
        You still fund the wallet yourself, and Cassie can only trade what is available there.
      </p>
      <div className={s.ctaRow}>
        <button
          type="button"
          className={`${s.btn} ${s.btnPrimary}`}
          onClick={enablePermission}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Enabling permission" : "Enable trading permission"}
          <span className={s.arrow} aria-hidden>→</span>
        </button>
      </div>
      {error && <p className={s.fineprint}>{error}</p>}
    </div>
  );
}

function StepFund({
  onSkip,
  onNext,
  walletAddress,
  depositAddress,
  error,
}: {
  onSkip: () => void;
  onNext: () => void;
  walletAddress: string | null;
  depositAddress?: string | null;
  error: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const address = depositAddress ?? walletAddress;
  const multiChain = Boolean(depositAddress);
  const depositUri = address
    ? multiChain ? `ethereum:${address}` : `ethereum:${address}@8453`
    : null;
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Creating wallet";

  async function copy() {
    if (!address) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    await window.navigator.clipboard.writeText(address);
  }

  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step three · Fund</span>
      <h1 className={s.display}>
        Send some <em>USDC</em>.
      </h1>
      <p className={s.lede}>
        {multiChain
          ? "Cassie has a deposit address minted only for you. Send USDC on Arc, Base, Arbitrum, Ethereum, Optimism, Polygon, or Avalanche."
          : "Cassie trades from a Base wallet — minted only for you. Scan to deposit USDC, or copy the address."}
      </p>

      <div className={s.fundCard}>
        <div className={s.qrWrap}>
          {depositUri ? <StyledQR data={depositUri} size={196} /> : <span className={s.fundLabel}>Wallet pending</span>}
        </div>
        <div className={s.fundMeta}>
          <span className={s.fundLabel}>{multiChain ? "Your deposit address" : "Your Base wallet"}</span>
          <span className={s.fundAddress}>{short}</span>
          <button type="button" className={s.fundCopy} onClick={copy} disabled={!address}>
            {copied ? "Copied" : "Copy address"}
          </button>
          <span className={s.fundStatus}>
            <span className={s.fundPulse} aria-hidden />
            {error ?? (multiChain ? "Watching for USDC on all supported chains" : "Watching for USDC on Base")}
          </span>
        </div>
      </div>

      <div className={s.ctaRow}>
        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onSkip}>
          I'll do this later
        </button>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onNext}>
          Continue
          <span className={s.arrow} aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

const presets = [25, 50, 100, 250];
const minDefaultTradeSizeUsd = 6;

function StepDefaults({
  onNext,
  syncAccount,
  defaultTradeSizeUsd,
}: {
  onNext: () => void;
  syncAccount: (input?: { defaultTradeSizeUsd?: number }) => Promise<unknown>;
  defaultTradeSizeUsd: number;
}) {
  const [value, setValue] = useState(formatTradeSize(defaultTradeSizeUsd));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(formatTradeSize(defaultTradeSizeUsd));
  }, [defaultTradeSizeUsd]);

  async function save() {
    const next = Number(value);
    if (!Number.isFinite(next) || next < minDefaultTradeSizeUsd) {
      setError(`Enter at least $${minDefaultTradeSizeUsd}.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await syncAccount({ defaultTradeSizeUsd: next });
      onNext();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step four · Defaults</span>
      <h1 className={s.display}>
        How much per <em>trade</em>?
      </h1>
      <p className={s.lede}>
        When you tag <span className={s.mention}>@cassiedottrade</span> trade this, I'll deploy this amount from your wallet.
      </p>

      <label className={s.amountField}>
        <span className={s.amountCurrency}>$</span>
        <input
          type="text"
          inputMode="decimal"
          className={s.amountInput}
          value={value}
          onChange={(e) => {
            setError(null);
            setValue(e.target.value.replace(/[^0-9.]/g, ""));
          }}
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
            onClick={() => {
              setError(null);
              setValue(String(p));
            }}
          >
            ${p}
          </button>
        ))}
      </div>

      <p className={s.fineprint}>
        Counter and watch inherit this size. You can change it later from the sidebar.
      </p>
      {error ? <p className={s.fineprint} role="alert">{error}</p> : null}

      <div className={s.ctaRow}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={save} disabled={saving}>
          {saving ? "Saving" : "Save & continue"}
          <span className={s.arrow} aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

type TelegramConnection = {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
};

function StepNotify({
  onSkip,
  onNext,
  telegram,
  beginTelegramConnect,
  refreshAccount,
}: {
  onSkip: () => void;
  onNext: () => void;
  telegram: TelegramConnection | null;
  beginTelegramConnect: () => Promise<{ connectUrl: string; expiresAt: string }>;
  refreshAccount: () => Promise<{ telegram: TelegramConnection | null } | null>;
}) {
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "waiting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const connectedLabel = telegram?.username
    ? `@${telegram.username}`
    : [telegram?.firstName, telegram?.lastName].filter(Boolean).join(" ") || "Telegram";

  useEffect(() => {
    if (telegram || !connectUrl) return;
    const interval = window.setInterval(() => {
      void refreshAccount();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [connectUrl, refreshAccount, telegram]);

  async function connectTelegram() {
    if (telegram || status === "loading") return;
    if (connectUrl) {
      const opened = window.open(connectUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        setError("Telegram window could not be opened. Allow pop-ups and try again.");
        setStatus("error");
        return;
      }
      setStatus("waiting");
      return;
    }

    setStatus("loading");
    setError(null);
    const telegramWindow = window.open("about:blank", "_blank");

    try {
      const session = await beginTelegramConnect();
      setConnectUrl(session.connectUrl);
      if (!telegramWindow) {
        throw new Error("Telegram window could not be opened. Allow pop-ups and try again.");
      }
      telegramWindow.opener = null;
      telegramWindow.location.href = session.connectUrl;
      setStatus("waiting");
    } catch (caught) {
      telegramWindow?.close();
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  }

  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step five · Notify</span>
      <h1 className={s.display}>
        Stay in the <em>loop</em>.
      </h1>
      <p className={s.lede}>
        Connect Telegram and I'll ping you the moment a trade fills, a{" "}
        <em>watch</em> moves, or a <em>counter</em> triggers.
      </p>

      <div className={s.tgCard}>
        <span className={s.tgIcon} aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M21.94 4.36 18.6 20.1c-.25 1.1-.9 1.38-1.83.86l-5.05-3.72-2.44 2.35c-.27.27-.5.5-1 .5l.36-5.12L17.96 6.4c.4-.36-.09-.56-.62-.2L4.9 14.1l-5.05-1.58c-1.1-.34-1.12-1.1.23-1.63L20.5 2.78c.92-.34 1.72.22 1.44 1.58Z" transform="translate(1)" />
          </svg>
        </span>
        <div className={s.tgInfo}>
          <span className={s.tgLabel}>Telegram</span>
          {telegram ? (
            <span className={s.tgConnected}>
              <span className={s.tgCheck} aria-hidden />
              Connected as <strong>{connectedLabel}</strong>
            </span>
          ) : (
            <span className={s.tgHelp}>
              {status === "waiting"
                ? "Waiting for your /start message in Telegram."
                : "Real-time fills, watches, and counters — straight to your DMs."}
            </span>
          )}
        </div>
      </div>
      {error && <p className={s.fineprint}>{error}</p>}

      <div className={s.ctaRow}>
        {telegram ? (
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onNext}>
            Continue
            <span className={s.arrow} aria-hidden>→</span>
          </button>
        ) : (
          <>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onSkip}>
              I'll do this later
            </button>
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={connectTelegram}
              disabled={status === "loading"}
            >
              {status === "loading"
                ? "Preparing Telegram"
                : status === "waiting"
                  ? "Open Telegram"
                  : "Connect Telegram"}
              <span className={s.arrow} aria-hidden>→</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StepFirstMention() {
  return (
    <div className={s.step}>
      <span className={s.eyebrow}>Step six · Try it</span>
      <h1 className={s.display}>
        Now <em>mention me</em>.
      </h1>
      <p className={s.lede}>
        Under any market-flavoured tweet, reply with <span className={s.mention}>@cassiedottrade trade this</span>. I'll do the rest.
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
          <span className={s.mockReplyMention}>@cassiedottrade</span> trade this
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

function formatTradeSize(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, "");
}
