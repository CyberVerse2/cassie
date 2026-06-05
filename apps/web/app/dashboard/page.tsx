"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import tweetRun from "../../../../docs/test-run-tweets.json";
import { StyledQR } from "../components/styled-qr";
import type { CassieActivityItem } from "../lib/activity";
import { type CassieDashboardPayload, type CassiePosition, useCassieAccount } from "../lib/use-cassie-account";
import { xHandleFromUrl } from "../lib/x-post";
import s from "./dashboard.module.css";

const tickerImages: Record<string, string> = {
  SOL: "https://assets.dub.co/companies/polymarket.svg",
  ETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  AI16Z: "https://assets.coingecko.com/coins/images/51322/large/ai16z.png",
  FED: "https://assets.dub.co/companies/polymarket.svg",
  BTC: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  HYPE: "https://app.hyperliquid.xyz/coins/HYPE.svg",
  AVNT: "https://assets.dub.co/companies/polymarket.svg",
  GOLD: "https://assets.dub.co/companies/polymarket.svg",
};

const tokenImages: Record<string, string> = {
  SOL: "https://assets.dub.co/companies/polymarket.svg",
  ETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  FED: "https://assets.dub.co/companies/polymarket.svg",
  BTC: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  HYPE: "https://app.hyperliquid.xyz/coins/HYPE.svg",
};

const tickerStrip = [
  { sym: "SOL", label: "22 trades" },
  { sym: "ETH", label: "14 trades" },
  { sym: "AI16Z", label: "35 trades" },
  { sym: "FED", label: "60 trades" },
  { sym: "BTC", label: "85 trades" },
  { sym: "HYPE", label: "73 trades" },
  { sym: "AVNT", label: "98 trades" },
  { sym: "GOLD", label: "41 trades" },
];

const watching = [
  {
    id: "BTC",
    title: "BTC to $120k by quarter end",
    source: "@maya_trades",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    side: "LONG",
    sideTone: "long",
    watchedAt: "$101,840",
    current: "$104,210",
    changePct: "+2.3%",
    hypoPnl: "+$2.33",
    tone: "up",
    watchedAge: "2h",
  },
  {
    id: "ETH",
    title: "ETH back to $2,800",
    source: "@noah_eth",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    side: "SHORT",
    sideTone: "short",
    watchedAt: "$3,108",
    current: "$3,042",
    changePct: "+2.1%",
    hypoPnl: "+$2.12",
    tone: "up",
    watchedAge: "5h",
  },
  {
    id: "SOL",
    title: "SOL ETF approval locks YES",
    source: "@ira_markets",
    venue: "poly",
    venueLabel: "Polymarket",
    side: "YES",
    sideTone: "yes",
    watchedAt: "61¢",
    current: "63¢",
    changePct: "+3.3%",
    hypoPnl: "+$3.27",
    tone: "up",
    watchedAge: "1d",
  },
];

const taggedTweetAges = ["2h", "5h", "11h", "1d", "2d", "3d"] as const;
const taggedTweetPrompts = ["trade this", "trade this", "critic this", "watch this", "trade this", "trade this"] as const;

type TestRunTweet = {
  url: string;
  current: boolean;
  authorName?: string;
  handle?: string;
  avatarUrl?: string;
  date?: string;
  text?: string;
  cassiePrompt?: string;
  unavailable?: boolean;
};

function hasDisplayText(tweet: TestRunTweet): tweet is TestRunTweet & { text: string } {
  return !tweet.unavailable && typeof tweet.text === "string" && tweet.text.trim().length > 0;
}

function summarizeTweetText(text: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/pic\.twitter\.com\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 132) return cleaned;
  const cutoff = cleaned.lastIndexOf(" ", 132);
  return `${cleaned.slice(0, cutoff > 88 ? cutoff : 132).trim()}...`;
}

const taggedTweets = (tweetRun.tweets as TestRunTweet[]).filter(hasDisplayText).slice(0, 6).map((tweet, index) => {
  const handle = xHandleFromUrl(tweet.url);
  const displayHandle = tweet.handle ?? `@${handle}`;
  return {
    ...tweet,
    authorName: tweet.authorName ?? handle,
    handle: displayHandle,
    avatarUrl: tweet.avatarUrl ?? `https://unavatar.io/x/${displayHandle.replace(/^@/, "")}`,
    age: tweet.date ?? taggedTweetAges[index]!,
    cassiePrompt: tweet.cassiePrompt ?? taggedTweetPrompts[index]!,
    preview: summarizeTweetText(tweet.text),
  };
});

const ranges = ["1D", "1W", "1M", "1Y", "All"] as const;

const usdcIcon = "https://assets.coingecko.com/coins/images/6319/large/usdc.png";

const dashboardQueryKeys = {
  dashboard: ["dashboard"] as const,
  positionMarks: (positionIds: string[]) => ["dashboard", "positionMarks", positionIds] as const,
};

export default function Dashboard() {
  const account = useCassieAccount();

  return (
    <main className={s.shell}>
      <Aside
        walletAddress={account.walletAddress}
        login={account.login}
        logout={account.logout}
        authenticated={account.authenticated}
        userProfile={account.userProfile}
        defaultTradeSizeUsd={account.account?.defaultTradeSizeUsd ?? 50}
        updateDefaultTradeSize={account.updateDefaultTradeSize}
      />
      <Center
        accountReady={account.ready}
        authenticated={account.authenticated}
        fetchDashboard={account.fetchDashboard}
        fetchPositionMarks={account.fetchPositionMarks}
        closePosition={account.closePosition}
        refreshAccount={account.refreshAccount}
      />
      <Voice />
    </main>
  );
}

function Aside({
  walletAddress,
  login,
  logout,
  authenticated,
  userProfile,
  defaultTradeSizeUsd,
  updateDefaultTradeSize,
}: {
  walletAddress: string | null;
  login: () => void;
  logout: () => Promise<void>;
  authenticated: boolean;
  userProfile: {
    name: string;
    handle: string;
    avatarUrl: string | null;
    initial: string;
  } | null;
  defaultTradeSizeUsd: number;
  updateDefaultTradeSize: (value: number) => Promise<unknown>;
}) {
  const [copied, setCopied] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const depositUri = walletAddress ? `ethereum:${walletAddress}@8453` : null;

  async function copyAddress() {
    if (!walletAddress) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    await window.navigator.clipboard.writeText(walletAddress);
  }

  async function requestLogout() {
    if (!authenticated || loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <aside className={s.aside}>
      <a className={s.brand} href="/" aria-label="Cassie home">
        <img className="mark" src="/cassie-logo-transparent.png" alt="" aria-hidden />
        <span>Cassie</span>
      </a>

      <div className={s.depositCard} id="deposit">
        <div className={s.qrFrame}>
          <div className={s.qrSurface}>
            {depositUri ? (
              <StyledQR data={depositUri} />
            ) : (
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={login}>
                Sign in
              </button>
            )}
            <span className={`${s.qrCorner} ${s.qrCornerTopLeft}`} aria-hidden />
            <span className={`${s.qrCorner} ${s.qrCornerTopRight}`} aria-hidden />
            <span className={`${s.qrCorner} ${s.qrCornerBottomLeft}`} aria-hidden />
            <span className={`${s.qrCorner} ${s.qrCornerBottomRight}`} aria-hidden />
          </div>
          <div className={s.qrMetaLine}>
            <span>Base USDC</span>
            <code>{walletAddress ? shortAddress(walletAddress) : "Sign in"}</code>
          </div>
        </div>
      </div>

      <div className={s.mentionRow}>
        <a className={`${s.btn} ${s.btnPrimary}`} href="#deposit">
          <ActionIcon name="deposit" />
          Deposit
        </a>
        <button
          className={`${s.btn} ${s.copyDepositBtn}`}
          type="button"
          onClick={copyAddress}
          disabled={!authenticated || !walletAddress}
          aria-label="Copy Base deposit address"
          title={copied ? "Copied" : "Copy address"}
        >
          <ActionIcon name={copied ? "check" : "copy"} />
        </button>
      </div>

      <Defaults
        authenticated={authenticated}
        defaultTradeSizeUsd={defaultTradeSizeUsd}
        updateDefaultTradeSize={updateDefaultTradeSize}
      />

      <nav className={s.nav} aria-label="Portfolio actions">
        <span className={s.navSection}>Move</span>
        <a className={s.navLink} href="#send">
          <ActionIcon name="send" />
          <span>Send</span>
        </a>
        <a className={s.navLink} href="#swap">
          <ActionIcon name="swap" />
          <span>Swap</span>
        </a>

        <span className={s.navSection}>Connect</span>
        <a className={s.navLink} href="#telegram">
          <ActionIcon name="telegram" />
          <span>Telegram alerts</span>
        </a>

        <span className={s.navSection}>Portfolio</span>
        <a className={s.navLink} href="#export-wallet">
          <ActionIcon name="export" />
          <span>Export keys</span>
        </a>
      </nav>

      <div className={`${s.identity} ${s.identityDock}`}>
        <span className={s.identityAvatar}>
          {userProfile?.avatarUrl ? (
            <img src={userProfile.avatarUrl} alt="" aria-hidden />
          ) : (
            userProfile?.initial ?? "C"
          )}
        </span>
        <div className={s.identityText}>
          <span className={s.identityName}>{userProfile?.name ?? "Cassie user"}</span>
          <span className={s.identityMeta}>{userProfile?.handle ?? "Sign in with X"}</span>
        </div>
        {authenticated ? (
          <button
            type="button"
            className={s.logoutBtn}
            onClick={() => void requestLogout()}
            disabled={loggingOut}
            aria-label="Log out"
            title="Log out"
          >
            <ActionIcon name="logout" />
            <span>{loggingOut ? "Logging out" : "Log out"}</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function Defaults({
  authenticated,
  defaultTradeSizeUsd,
  updateDefaultTradeSize,
}: {
  authenticated: boolean;
  defaultTradeSizeUsd: number;
  updateDefaultTradeSize: (value: number) => Promise<unknown>;
}) {
  const minDefaultTradeSizeUsd = 6;
  const [trade, setTrade] = useState(formatTradeSize(defaultTradeSizeUsd));
  const [savedTrade, setSavedTrade] = useState(defaultTradeSizeUsd);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTrade(formatTradeSize(defaultTradeSizeUsd));
    setSavedTrade(defaultTradeSizeUsd);
  }, [defaultTradeSizeUsd]);

  async function saveTrade() {
    if (!authenticated || saving) return;
    const next = Number(trade);
    if (!Number.isFinite(next) || next < minDefaultTradeSizeUsd) {
      setError(`Enter at least $${minDefaultTradeSizeUsd}.`);
      return;
    }
    if (next === savedTrade) return;

    setSaving(true);
    setError(null);
    try {
      await updateDefaultTradeSize(next);
      setSavedTrade(next);
      setTrade(formatTradeSize(next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className={s.defaults}>
      <div className={s.defaultsHead}>
        <span className={s.defaultsLabel}>Configure</span>
        <span className={s.defaultsCaption}>default cassie will trade</span>
      </div>
      <span className={s.defaultsField}>
        <span className={s.defaultsCurrency}>$</span>
        <input
          type="text"
          inputMode="decimal"
          className={s.defaultsInput}
          value={trade}
          onChange={(e) => {
            setError(null);
            setTrade(e.target.value.replace(/[^0-9.]/g, ""));
          }}
          onBlur={saveTrade}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          disabled={!authenticated || saving}
          aria-label="Default trade size in USDC"
        />
      </span>
      {error ? <span className={s.defaultsError} role="alert">{error}</span> : null}
    </label>
  );
}

function formatTradeSize(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, "");
}

interface DataPoint {
  date: string;
  value: number;
  change: number;
}

function Center({
  accountReady,
  authenticated,
  fetchDashboard,
  fetchPositionMarks,
  closePosition,
  refreshAccount,
}: {
  accountReady: boolean;
  authenticated: boolean;
  fetchDashboard: () => Promise<CassieDashboardPayload>;
  fetchPositionMarks: (positionIds: string[]) => Promise<CassiePosition[]>;
  closePosition: (positionId: string) => Promise<CassiePosition>;
  refreshAccount: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [selectedRange, setSelectedRange] = useState<"1D" | "1W" | "1M" | "1Y" | "All">("1D");
  const [hoveredData, setHoveredData] = useState<DataPoint | null>(null);
  const [activeTab, setActiveTab] = useState<"wallet" | "activity">("wallet");
  const [walletView, setWalletView] = useState<"trades" | "watching">("trades");
  const [closingId, setClosingId] = useState<string | null>(null);
  const dashboardEnabled = accountReady && authenticated;
  const dashboardQuery = useQuery({
    queryKey: dashboardQueryKeys.dashboard,
    queryFn: fetchDashboard,
    enabled: dashboardEnabled,
  });
  const dashboard = dashboardEnabled ? dashboardQuery.data : undefined;
  const storedOpenPositions = dashboard?.openPositions ?? [];
  const liveMarkIds = useMemo(() => storedOpenPositions
    .filter((position) => position.status === "open" && position.venue === "hyperliquid")
    .map((position) => position.positionId)
    .sort(), [storedOpenPositions]);
  const positionMarksQuery = useQuery({
    queryKey: dashboardQueryKeys.positionMarks(liveMarkIds),
    queryFn: () => fetchPositionMarks(liveMarkIds),
    enabled: liveMarkIds.length > 0,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
  const openPositions = useMemo(() =>
    mergePositions(storedOpenPositions, positionMarksQuery.data ?? []),
    [positionMarksQuery.data, storedOpenPositions]
  );
  const closedPositions = dashboard?.closedPositions ?? [];
  const tradePositions = useMemo(() =>
    [...openPositions, ...closedPositions],
    [closedPositions, openPositions],
  );
  const activity = dashboard?.activity ?? [];
  const dashboardError = dashboardEnabled ? errorMessage(dashboardQuery.error) : null;

  const portfolioBalance = useMemo(() =>
    portfolioBalanceFromDashboard(dashboard, openPositions),
    [dashboard, openPositions]
  );
  const rangeData = useMemo(() =>
    filterPortfolioHistory(portfolioBalance.history, selectedRange),
    [portfolioBalance.history, selectedRange]
  );
  const currentValPoint = rangeData[rangeData.length - 1];
  const displayedPoint = hoveredData || currentValPoint;
  const portfolioLabel = `$${portfolioBalance.currentUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const displayedBalance = displayedPoint.value;
  const largestPositionMover = openPositions
    .slice()
    .sort((left, right) => Math.abs(right.unrealizedPnlUsd) - Math.abs(left.unrealizedPnlUsd))[0] ?? null;
  const netInvested = openPositions.reduce((total, position) => total + position.marginUsd, 0);
  const unrealized = openPositions.reduce((total, position) => total + position.unrealizedPnlUsd, 0);

  const closeMutation = useMutation({
    mutationFn: closePosition,
    onMutate: (positionId) => {
      setClosingId(positionId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<CassieDashboardPayload>(dashboardQueryKeys.dashboard, (current) =>
        current ? mergeDashboardPosition(current, updated) : current
      );
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.dashboard });
      void refreshAccount();
    },
    onSettled: () => {
      setClosingId(null);
    },
  });

  const closeError = errorMessage(closeMutation.error);
  const effectivePositionError = dashboardError ?? closeError;

  async function requestClose(position: CassiePosition) {
    if (!window.confirm(`Close ${positionSymbol(position)} ${position.side}?`)) return;
    closeMutation.mutate(position.positionId);
  }

  return (
    <section className={s.main}>
      <div className={s.tickerShell}>
        <div className={s.tickerStrip}>
          {[...tickerStrip, ...tickerStrip].map((t, i) => (
            <span className={s.tickerPill} key={`${t.sym}-${i}`}>
              <span className="tk-icon">
                <img className={s.assetIconImage} src={tickerImages[t.sym]} alt="" />
              </span>
              <span className="tk-sym">${t.sym}</span>
              <span className="tk-count">{t.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className={s.tabs} role="tablist">
        <button
          type="button"
          className={`${s.tab} ${activeTab === "wallet" ? s.tabActive : ""}`}
          role="tab"
          aria-selected={activeTab === "wallet"}
          onClick={() => setActiveTab("wallet")}
        >
          Portfolio
          <span className="tab-count">{portfolioLabel}</span>
        </button>
        <button
          type="button"
          className={`${s.tab} ${activeTab === "activity" ? s.tabActive : ""}`}
          role="tab"
          aria-selected={activeTab === "activity"}
          onClick={() => setActiveTab("activity")}
        >
          Activity
          <span className="tab-count">{activity.length}</span>
        </button>
      </div>

      {activeTab === "activity" && <ActivityPanel activity={activity} error={dashboardError} />}

      {activeTab === "wallet" && (
      <div className={s.content}>
        <header className={s.sectionHeader}>
          <h2>Portfolio balance</h2>
          <p>Base USDC plus open position P/L across Polymarket and Hyperliquid.</p>
        </header>

        <div className={s.chartCard}>
          <div className={s.chartTop}>
            <span className={s.chartPrice}>
              ${displayedBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className={`${s.deltaPill} ${displayedPoint.change >= 0 ? s.deltaUp : s.deltaDown}`}>
              {displayedPoint.change >= 0 ? "↑" : "↓"} {Math.abs(displayedPoint.change).toFixed(2)}%
            </span>
          </div>
          <div className={s.chartBody}>
            <LineChart key={selectedRange} data={rangeData} onHover={setHoveredData} />
          </div>
          <div className={s.chartFoot}>
            <div className={s.portfolioMover}>
              <div className={s.moverHeader}>
                <span className={s.moverLabel}>Largest position move</span>
              </div>
              {largestPositionMover ? (
              <div className={s.moverBody}>
                <div className={s.moverAssetInfo}>
                  <span className={`${s.tokenCell} ${s.moverTokenCell}`}>
                    <span className="tk">
                      <img className={`${s.assetIconImage} ${s.moverTokenImage}`} src={positionTokenIcon(largestPositionMover)} alt="" />
                    </span>
                    <span className={`tk-venue ${venueTone(largestPositionMover.venue)}`}>
                      <VenueIcon venue={venueTone(largestPositionMover.venue)} size={7} />
                    </span>
                  </span>
                  <div className="mover-main">
                    <strong>{positionSymbol(largestPositionMover)}</strong>
                    <span>{largestPositionMover.exitPlan.thesis}</span>
                  </div>
                </div>
                <div className="mover-value">
                  <strong className={largestPositionMover.unrealizedPnlUsd >= 0 ? "up" : "down"}>
                    <span className="mover-delta-icon" aria-hidden>
                      {largestPositionMover.unrealizedPnlUsd >= 0 ? "▲" : "▼"}
                    </span>
                    {formatUsd(Math.abs(largestPositionMover.unrealizedPnlUsd))}
                  </strong>
                  <span>
                    <span className={`mover-side ${sideTone(largestPositionMover.side)}`}>
                      {largestPositionMover.side.toUpperCase()}
                    </span>
                    <span className="mover-sep" aria-hidden>·</span>
                    {formatUsd(largestPositionMover.positionEquityUsd)}
                  </span>
                </div>
              </div>
              ) : (
                <div className={s.moverBody}>
                  <div className="mover-main">
                    <strong>No open positions</strong>
                    <span>Filled Cassie trades will appear here.</span>
                  </div>
                </div>
              )}
            </div>
            <div className={s.ranges}>
              {ranges.map((r) => (
                <button
                  key={r}
                  className={`${s.rangeBtn} ${r === selectedRange ? s.rangeActive : ""}`}
                  onClick={() => {
                    setSelectedRange(r);
                    setHoveredData(null);
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={s.summary}>
          <div className={s.summaryRow}>
            <div className={s.summaryVenue}>
              <div className={s.venueStack}>
                <div className={`${s.venueStackIcon} ${s.venueStackFirst}`}>
                  <VenueIcon venue="hyper" size={12} />
                </div>
                <div className={`${s.venueStackIcon} ${s.venueStackSecond}`}>
                  <VenueIcon venue="poly" size={12} />
                </div>
              </div>
              <span>Positions</span>
            </div>
            <div className={s.summaryCell}>
              <span className="label">Margin</span>
              <span className="value">{formatUsd(netInvested)}</span>
            </div>
            <div className={s.summaryCell}>
              <span className="label">Closed</span>
              <span className="value">{closedPositions.length}</span>
            </div>
            <div className={s.summaryCell}>
              <span className="label">Unrealized</span>
              <span className={`value ${unrealized >= 0 ? "up" : "down"}`}>{formatSignedUsd(unrealized)}</span>
            </div>
          </div>
        </div>

        <div className={s.walletSubtabs} role="tablist" aria-label="Portfolio view">
          <button
            type="button"
            role="tab"
            aria-selected={walletView === "trades"}
            className={`${s.walletSubtab} ${walletView === "trades" ? s.walletSubtabActive : ""}`}
            onClick={() => setWalletView("trades")}
          >
            Trades
            <span className={s.walletSubtabCount}>{tradePositions.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={walletView === "watching"}
            className={`${s.walletSubtab} ${walletView === "watching" ? s.walletSubtabActive : ""}`}
            onClick={() => setWalletView("watching")}
          >
            Watching
            <span className={s.walletSubtabCount}>{watching.length}</span>
          </button>
        </div>

        {walletView === "trades" && (
        <div className={s.table}>
          <div className={`${s.tr} ${s.thead}`} role="row">
            <span>Asset</span>
            <span>Position</span>
            <span className={s.amountHead}>P/L</span>
            <span className={s.amountHead}>Value</span>
            <span />
          </div>
          {effectivePositionError ? (
            <div className={s.emptyState} role="alert">{effectivePositionError}</div>
          ) : null}
          {tradePositions.length === 0 && !effectivePositionError ? (
            <div className={s.emptyState}>No trades yet.</div>
          ) : null}
          {tradePositions.map((position) => (
            <div className={s.tr} role="row" key={position.positionId}>
              <span className={s.tokenCell}>
                <span className="tk">
                  <img className={s.tokenImage} src={positionTokenIcon(position)} alt="" />
                </span>
                <span className={`tk-venue ${venueTone(position.venue)}`} title={position.venue}>
                  <VenueIcon venue={venueTone(position.venue)} size={11} />
                </span>
                <span className="entry-mark" />
              </span>
              <span className={s.tradeCopy}>
                <strong>{positionSymbol(position)} {position.side.toUpperCase()}</strong>
                <span>{position.exitPlan.thesis}</span>
              </span>
              <span className={s.amountCell}>
                <span className={s.amountValue}>{formatSignedUsd(position.unrealizedPnlUsd)}</span>
                <span
                  className={`${s.valueDelta} ${position.unrealizedPnlUsd >= 0 ? s.amountUp : s.amountDown}`}
                >
                  <span className={s.amountDeltaIcon} aria-hidden>
                    {position.unrealizedPnlUsd >= 0 ? "▲" : "▼"}
                  </span>
                  {Math.abs(position.unrealizedPnlPct).toFixed(2)}%
                </span>
              </span>
              <span className={s.valueCell}>
                <span className={s.valuePrice}>{formatUsd(position.positionEquityUsd)}</span>
                <span className={`${s.amountSide} ${s[`amountSide_${sideTone(position.side)}`]}`}>
                  {position.leverage ? `${position.leverage}x exposure` : position.status}
                </span>
              </span>
              <span className={s.tradeActions}>
                <a className={`${s.tradeActionBtn} ${s.shareTradeBtn}`} href={`/trades/${encodeURIComponent(position.positionId)}/pnl`}>
                  Share
                </a>
                <button
                  className={s.tradeActionBtn}
                  type="button"
                  onClick={() => void requestClose(position)}
                  disabled={!canRequestClose(position) || closingId === position.positionId}
                >
                  {position.status === "closing" || closingId === position.positionId
                    ? "Closing"
                    : position.status === "closed"
                      ? "Closed"
                      : "Close"}
                </button>
              </span>
            </div>
          ))}
        </div>
        )}

        {walletView === "watching" && (
        <div className={s.table}>
          <div className={`${s.tr} ${s.thead}`} role="row">
            <span>Asset</span>
            <span>Idea</span>
            <span className={s.amountHead}>Now</span>
            <span className={s.amountHead}>If $100</span>
            <span />
          </div>
          {watching.map((w) => (
            <div className={s.tr} role="row" key={w.title}>
              <span className={s.tokenCell}>
                <span className="tk">
                  <img className={s.tokenImage} src={tokenImages[w.id]} alt="" />
                </span>
                <span className={`tk-venue ${w.venue}`} title={w.venueLabel}>
                  <VenueIcon venue={w.venue} size={11} />
                </span>
              </span>
              <span className={s.tradeCopy}>
                <strong>{w.title}</strong>
                <span>
                  via <span className={s.watchingSource}>{w.source}</span> · watched {w.watchedAge} ago at {w.watchedAt}
                </span>
              </span>
              <span className={s.amountCell}>
                <span className={s.amountValue}>{w.current}</span>
                <span
                  className={`${s.valueDelta} ${w.tone === "up" ? s.amountUp : s.amountDown}`}
                >
                  <span className={s.amountDeltaIcon} aria-hidden>
                    {w.tone === "up" ? "▲" : "▼"}
                  </span>
                  {w.changePct.replace(/^[+-]/, "")} since watch
                </span>
              </span>
              <span className={s.valueCell}>
                <span
                  className={`${s.amountValue} ${w.tone === "up" ? s.watchingPnlUp : s.watchingPnlDown}`}
                >
                  {w.hypoPnl}
                </span>
                <span className={`${s.amountSide} ${s[`amountSide_${w.sideTone}`]}`}>
                  {w.side}
                </span>
              </span>
              <button className={s.watchTradeBtn} aria-label={`Trade ${w.title} now`}>
                Trade
              </button>
            </div>
          ))}
        </div>
        )}

      </div>
      )}
    </section>
  );
}

function ActivityPanel({ activity, error }: { activity: CassieActivityItem[]; error: string | null }) {
  const groups = groupActivity(activity);
  return (
    <div className={s.activity}>
      <header className={s.activityHeader}>
        <div className={s.activityIntro}>
          <h2>Activity</h2>
          <p>History of your interactions with Cassie.</p>
        </div>
        <button type="button" className={s.activityFilter}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="6" y1="12" x2="18" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          Transactions
        </button>
      </header>

      <div className={s.activityFeed}>
        {error ? <div className={s.emptyState} role="alert">{error}</div> : null}
        {!error && groups.length === 0 ? <div className={s.emptyState}>No activity yet.</div> : null}
        {groups.map((group) => (
          <section className={s.activityGroup} key={group.date}>
            <h3 className={s.activityDate}>{group.date}</h3>
            <ul className={s.activityList}>
              {group.items.map((item) => (
                <ActivityItem item={item} key={item.id} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ActivityItem({ item }: { item: CassieActivityItem }) {
  const statusTone = item.error ? s.amountDown : item.status === "succeeded" || item.status === "completed" ? s.amountUp : "";
  return (
    <li className={s.activityRow}>
      <span className={`${s.activityCmdBadge} ${s[`activityCmd_${activityCommand(item.kind)}`]}`} aria-hidden>
        <CommandGlyph kind={item.kind} />
      </span>
      <div className={s.activityLabel}>
        <span className={s.activityCmd}>{activityCommand(item.kind)}</span>
        <span className={s.activityTime}>{formatActivityTime(item.at)}</span>
      </div>

      <div className={s.activityWatch}>
        <span className={s.activityAssetIcon}>
          <img src={activityIcon(item)} alt="" aria-hidden />
        </span>
        <div className={s.activityWatchText}>
          <strong>
            <span className={s.activityAssetSym}>{item.title}</span>
            <span className={`${s.amountSide} ${item.side ? s[`amountSide_${sideTone(item.side)}`] : ""}`}>
              {item.side?.toUpperCase() ?? item.status}
            </span>
          </strong>
          <span>
            {item.amountUsd != null ? `${formatUsd(item.amountUsd)} · ` : ""}
            {item.subtitle}
            {item.error ? (
              <>
                <span className={s.activityWatchSep} aria-hidden> · </span>
                <span className={statusTone}>{item.error}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <span className={s.activitySources}>
        <span className={s.activitySourceChip} title="Cassie">
          <img src="/cassie-logo-transparent.png" alt="Cassie" />
        </span>
        {item.source === "x" && (
          <span className={s.activitySourceChip} title="X">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </span>
        )}
      </span>
    </li>
  );
}

function CommandGlyph({ kind }: { kind: CassieActivityItem["kind"] }) {
  if (kind === "trade") {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    );
  }
  if (kind === "trade_close") {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 7 7 17" />
        <path d="M7 7h10v10" />
      </svg>
    );
  }
  if (kind === "watch") {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7h10l-3-3" />
      <path d="M17 17H7l3 3" />
    </svg>
  );
}

function groupActivity(activity: CassieActivityItem[]): Array<{ date: string; items: CassieActivityItem[] }> {
  const groups = new Map<string, CassieActivityItem[]>();
  for (const item of activity) {
    const date = formatActivityDate(item.at);
    groups.set(date, [...(groups.get(date) ?? []), item]);
  }
  return [...groups].map(([date, items]) => ({ date, items }));
}

function activityCommand(kind: CassieActivityItem["kind"]): "trade" | "close" | "watch" | "counter" {
  if (kind === "trade") return "trade";
  if (kind === "trade_close") return "close";
  if (kind === "watch") return "watch";
  return "counter";
}

function activityIcon(item: CassieActivityItem): string {
  const symbol = item.instrument?.replace(/-PERP$/u, "").split(/\s+/u)[0]?.toUpperCase();
  if (symbol && item.venue === "hyperliquid") return hyperliquidTokenIcon(symbol);
  if (symbol && tokenImages[symbol]) return tokenImages[symbol];
  if (item.instrument === "USDC") return usdcIcon;
  return "/cassie-logo-transparent.png";
}

function formatActivityDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatActivityTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function Voice() {
  return (
    <section className={s.voice}>
      <div className={s.voiceHero}>
        <div className={s.voiceLogo}>
          <img src="/cassie-logo-transparent.png" alt="" aria-hidden />
        </div>
      </div>

      <div className={s.voiceMeta}>
        <span className={s.voiceTitle}>
          cassie
          <span className="verified" aria-label="Twitter verified">
            <svg viewBox="0 0 22 22" aria-hidden>
              <defs>
                <linearGradient id="twitterGoldOuter" x1="4" x2="19.5" y1="1.5" y2="22" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#F4E72A" />
                  <stop offset=".539" stopColor="#CD8105" />
                  <stop offset=".68" stopColor="#CB7B00" />
                  <stop offset="1" stopColor="#F4E72A" />
                </linearGradient>
                <linearGradient id="twitterGoldInner" x1="5" x2="17.5" y1="2.5" y2="19.5" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#F9E87F" />
                  <stop offset=".406" stopColor="#E2B719" />
                  <stop offset=".989" stopColor="#E2B719" />
                </linearGradient>
              </defs>
              <path
                clipRule="evenodd"
                d="M13.596 3.011 11 .5 8.404 3.011l-3.576-.506-.624 3.558-3.19 1.692L2.6 11l-1.586 3.245 3.19 1.692.624 3.558 3.576-.506L11 21.5l2.596-2.511 3.576.506.624-3.558 3.19-1.692L19.4 11l1.586-3.245-3.19-1.692-.624-3.558-3.576.506ZM6 11.39l3.74 3.74 6.2-6.77L14.47 7l-4.8 5.23-2.26-2.26L6 11.39Z"
                fill="url(#twitterGoldOuter)"
                fillRule="evenodd"
              />
              <path
                clipRule="evenodd"
                d="M13.348 3.772 11 1.5 8.651 3.772l-3.235-.458-.565 3.219-2.886 1.531L3.4 11l-1.435 2.936 2.886 1.531.565 3.219 3.235-.458L11 20.5l2.348-2.272 3.236.458.564-3.219 2.887-1.531L18.6 11l1.435-2.936-2.887-1.531-.564-3.219-3.236.458ZM6 11.39l3.74 3.74 6.2-6.77L14.47 7l-4.8 5.23-2.26-2.26L6 11.39Z"
                fill="url(#twitterGoldInner)"
                fillRule="evenodd"
              />
              <path
                clipRule="evenodd"
                d="m6 11.39 3.74 3.74 6.197-6.767h.003V9.76l-6.2 6.77L6 12.79v-1.4Z"
                fill="#D18800"
                fillRule="evenodd"
              />
            </svg>
          </span>
          <span className="handle">@cassiedottrade</span>
        </span>
        <span className={s.voiceTag}>
          <span className="k">Orders placed</span>{" "}
          <span className="v">0</span>
        </span>
        <p className={s.voiceBio}>
          Tweets where people tagged Cassie, with the source post and command kept visible.
        </p>
      </div>

      <div className={s.feed}>
        {taggedTweets.map((tweet) => (
          <a className={s.post} href={tweet.url} target="_blank" rel="noreferrer" key={tweet.url}>
            <header className={s.postHead}>
              <img className="glyph" src={tweet.avatarUrl} alt="" aria-hidden />
              {tweet.authorName}
              <span className="handle">{tweet.handle}</span>
              <span className="dot-sep">·</span>
              <span className="handle">{tweet.age}</span>
            </header>
            <p className={s.postBody}>
              <span className="lnk">{tweet.handle}</span> tagged{" "}
              <span className="tk">@cassiedottrade</span>: {tweet.cassiePrompt}
            </p>
            <p className={s.postQuote}>{tweet.preview}</p>
          </a>
        ))}
      </div>
    </section>
  );
}

interface LineChartProps {
  data: DataPoint[];
  onHover: (data: DataPoint | null) => void;
}

function LineChart({ data, onHover }: LineChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const w = 1080;
  const h = 280;
  const pad = { l: 0, r: 0, t: 40, b: 10 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const valRange = max - min || 1;

  const chartMin = min - valRange * 0.08;
  const chartMax = max + valRange * 0.08;

  const xAt = (i: number) => data.length <= 1 ? pad.l + innerW : pad.l + (i / (data.length - 1)) * innerW;
  const yAt = (v: number) => pad.t + innerH - ((v - chartMin) / (chartMax - chartMin)) * innerH;

  const pathOf = (vals: number[]) => {
    let d = "";
    for (let i = 0; i < vals.length; i++) {
      const x = xAt(i);
      const y = yAt(vals[i]);
      if (i === 0) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
      else {
        const px = xAt(i - 1);
        const py = yAt(vals[i - 1]);
        const cx = px + (x - px) / 2;
        d += ` C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
      }
    }
    return d;
  };

  const mainPath = pathOf(values);
  const areaPath = `${mainPath} L${w.toFixed(1)},${h.toFixed(1)} L0,${h.toFixed(1)} Z`;

  const formatAxisValue = (val: number) => {
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return val.toFixed(0);
  };

  const dataIndexAt = (clientX: number, rect: DOMRect) => {
    const svgX = ((clientX - rect.left) / rect.width) * w;
    return Math.max(0, Math.min(data.length - 1, Math.round((svgX / w) * (data.length - 1))));
  };

  const setHoverIndex = (dataIndex: number) => {
    if (dataIndex === hoveredIndex) return;
    setHoveredIndex(dataIndex);
    onHover(data[dataIndex]);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverIndex(dataIndexAt(e.clientX, rect));
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    onHover(null);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverIndex(dataIndexAt(e.touches[0].clientX, rect));
  };

  return (
    <div className={s.chartFrame}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchMove}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseLeave}
        aria-label="Portfolio balance history"
      >
        <defs>
          <linearGradient id="walletFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-a)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--series-a)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <line x1="0" y1={pad.t + innerH * 0.25} x2={w} y2={pad.t + innerH * 0.25} className={s.chartGrid} />
        <line x1="0" y1={pad.t + innerH * 0.5} x2={w} y2={pad.t + innerH * 0.5} className={s.chartGrid} />
        <line x1="0" y1={pad.t + innerH * 0.75} x2={w} y2={pad.t + innerH * 0.75} className={s.chartGrid} />

        <text x="8" y={pad.t + innerH * 0.25 - 6} fill="var(--ink-faint)" fontSize="10" fontFamily="var(--stack-sans)" fontWeight="500">
          ${formatAxisValue(chartMax - (chartMax - chartMin) * 0.25)}
        </text>
        <text x="8" y={pad.t + innerH * 0.5 - 6} fill="var(--ink-faint)" fontSize="10" fontFamily="var(--stack-sans)" fontWeight="500">
          ${formatAxisValue(chartMax - (chartMax - chartMin) * 0.5)}
        </text>
        <text x="8" y={pad.t + innerH * 0.75 - 6} fill="var(--ink-faint)" fontSize="10" fontFamily="var(--stack-sans)" fontWeight="500">
          ${formatAxisValue(chartMax - (chartMax - chartMin) * 0.75)}
        </text>

        <path d={areaPath} className={s.chartFill} />

        <path d={mainPath} className={s.chartGlow} pathLength={100} />

        <path d={mainPath} className={s.chartLine} pathLength={100} />

        {hoveredIndex !== null && (
          <>
            <line
              x1={xAt(hoveredIndex)}
              y1={0}
              x2={xAt(hoveredIndex)}
              y2={h}
              className={s.chartCursorLine}
            />
            <circle
              cx={xAt(hoveredIndex)}
              cy={yAt(values[hoveredIndex])}
              r="7"
              className={s.chartCursorDot}
            />
            <circle
              cx={xAt(hoveredIndex)}
              cy={yAt(values[hoveredIndex])}
              r="3"
              fill="var(--ink)"
            />
          </>
        )}
      </svg>

      {hoveredIndex !== null && (
        <div
          className={s.tooltip}
          style={{
            left: `${(xAt(hoveredIndex) / w) * 100}%`,
            top: `${(yAt(values[hoveredIndex]) / h) * 100}%`,
          }}
        >
          <div className={s.tooltipDate}>{data[hoveredIndex].date}</div>
          <div className={s.tooltipRow}>
            <span className={s.tooltipLabel}>Balance</span>
            <span className={s.tooltipValue}>
              ${data[hoveredIndex].value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className={s.tooltipRow}>
            <span className={s.tooltipLabel}>Change</span>
            <span className={`${s.tooltipDelta} ${data[hoveredIndex].change >= 0 ? s.up : s.down}`}>
              {data[hoveredIndex].change >= 0 ? "↑" : "↓"} {Math.abs(data[hoveredIndex].change).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface VenueIconProps {
  venue: string;
  size?: number;
  className?: string;
}

type ActionIconName = "deposit" | "copy" | "check" | "send" | "swap" | "telegram" | "export" | "logout";

function ActionIcon({ name }: { name: ActionIconName }) {
  const common = {
    className: s.actionIcon,
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
  };

  if (name === "deposit") {
    return (
      <svg {...common}>
        <path d="M12 4v10" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 18h14" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg {...common}>
        <rect x="9" y="9" width="10" height="10" rx="2" />
        <path d="M5 15V7a2 2 0 0 1 2-2h8" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }

  if (name === "send") {
    return (
      <svg {...common}>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </svg>
    );
  }

  if (name === "swap") {
    return (
      <svg {...common}>
        <path d="M7 7h11" />
        <path d="m15 4 3 3-3 3" />
        <path d="M17 17H6" />
        <path d="m9 14-3 3 3 3" />
      </svg>
    );
  }

  if (name === "telegram") {
    return (
      <svg {...common}>
        <path d="M20 4 4 11l6 2 2 6 8-15Z" />
        <path d="m10 13 4-4" />
      </svg>
    );
  }

  if (name === "logout") {
    return (
      <svg {...common}>
        <path d="M10 17 5 12l5-5" />
        <path d="M5 12h11" />
        <path d="M14 4h5v16h-5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M12 14V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M5 18h14" />
    </svg>
  );
}

function VenueIcon({ venue, size = 16, className }: VenueIconProps) {
  if (venue === "hyper") {
    return (
      <svg
        viewBox="0 0 144 144"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <path
          d="M144 71.6991C144 119.306 114.866 134.582 99.5156 120.98C86.8804 109.889 83.1211 86.4521 64.116 84.0456C39.9942 81.0113 37.9057 113.133 22.0334 113.133C3.5504 113.133 0 86.2428 0 72.4315C0 58.3063 3.96809 39.0542 19.736 39.0542C38.1146 39.0542 39.1588 66.5722 62.132 65.1073C85.0007 63.5379 85.4184 34.8689 100.247 22.6271C113.195 12.0593 144 23.4641 144 71.6991Z"
          fill="var(--hyper-brand, #97FCE4)"
        />
      </svg>
    );
  }

  if (venue === "poly") {
    return (
      <svg
        viewBox="14 0 60 74"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M73.6713 33.8976V0L14.0132 16.8122V17.0854V56.915V57.188L73.6713 74.0002V40.1027V33.8976ZM67.8971 32.2704V7.56261L24.0613 19.9171L67.8971 32.2704ZM63.6137 37.0002L19.7873 24.6482V49.352L63.6137 37.0002ZM24.0615 54.0831L67.8971 66.4376V41.73L24.0615 54.0831Z"
          fill="var(--poly-brand, #0066FF)"
        />
      </svg>
    );
  }

  return null;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function positionSymbol(position: CassiePosition) {
  return (position.symbol?.trim() || position.instrument)
    .replace(/-PERP$/u, "")
    .replace(/^spot$/u, position.venue.toUpperCase());
}

function positionTokenIcon(position: CassiePosition) {
  const symbol = positionSymbol(position);
  if (position.venue === "hyperliquid") return hyperliquidTokenIcon(symbol);
  return tokenImages[symbol] ?? usdcIcon;
}

function hyperliquidTokenIcon(symbol: string) {
  return `https://app.hyperliquid.xyz/coins/${encodeURIComponent(symbol)}.svg`;
}

function mergePositions(current: CassiePosition[], updates: CassiePosition[]) {
  const updatesById = new Map(updates.map((position) => [position.positionId, position]));
  return current.map((position) => updatesById.get(position.positionId) ?? position);
}

function portfolioBalanceFromDashboard(
  dashboard: CassieDashboardPayload | undefined,
  openPositions: CassiePosition[],
) {
  const walletBalanceUsd = dashboard?.portfolioBalance.walletBalanceUsd ?? 0;
  const unrealizedPnlUsd = roundUsd(openPositions.reduce((total, position) => total + position.unrealizedPnlUsd, 0));
  const currentUsd = roundUsd(walletBalanceUsd + unrealizedPnlUsd);
  const serverHistory = dashboard?.portfolioBalance.history ?? [];
  const currentPoint = {
    date: serverHistory[serverHistory.length - 1]?.label ?? "Now",
    value: currentUsd,
    change: percentChange(serverHistory[0]?.valueUsd ?? currentUsd, currentUsd),
  };

  return {
    currentUsd,
    history: serverHistory.length === 0
      ? [currentPoint]
      : [
        ...serverHistory.slice(0, -1).map((point) => ({
          date: point.label,
          value: point.valueUsd,
          change: percentChange(serverHistory[0]?.valueUsd ?? point.valueUsd, point.valueUsd),
        })),
        currentPoint,
      ],
  };
}

function filterPortfolioHistory(data: DataPoint[], range: "1D" | "1W" | "1M" | "1Y" | "All") {
  if (range === "All") return data;
  const maxPoints = range === "1D" ? 24 : range === "1W" ? 7 : range === "1M" ? 30 : 52;
  return data.slice(-maxPoints);
}

function percentChange(start: number, current: number) {
  return start > 0 ? roundPct(((current - start) / start) * 100) : 0;
}

function mergeDashboardPosition(current: CassieDashboardPayload, update: CassiePosition): CassieDashboardPayload {
  const openPositions = upsertDashboardPosition(current.openPositions, update)
    .filter(isDashboardOpenPosition);
  const closedPositions = upsertDashboardPosition(current.closedPositions, update)
    .filter((position) => position.status === "closed");
  const alreadyOpen = openPositions.some((position) => position.positionId === update.positionId);
  const alreadyClosed = closedPositions.some((position) => position.positionId === update.positionId);

  return {
    ...current,
    openPositions: isDashboardOpenPosition(update) && !alreadyOpen
      ? [update, ...openPositions]
      : openPositions,
    closedPositions: update.status === "closed" && !alreadyClosed
      ? [update, ...closedPositions]
      : closedPositions,
  };
}

function upsertDashboardPosition(positions: CassiePosition[], update: CassiePosition) {
  return positions.map((position) =>
    position.positionId === update.positionId ? update : position
  );
}

function isDashboardOpenPosition(position: CassiePosition) {
  return position.status === "open"
    || position.status === "closing"
    || position.status === "close_failed";
}

function canRequestClose(position: CassiePosition) {
  return position.status === "open" || position.status === "close_failed";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : null;
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

function venueTone(venue: string) {
  return venue === "hyperliquid" ? "hyper" : venue === "polymarket" ? "poly" : venue;
}

function sideTone(side: string) {
  if (side === "short" || side === "sell" || side === "buy_no") return "short";
  if (side === "buy_yes") return "yes";
  return "long";
}

function formatUsd(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: number) {
  const absolute = formatUsd(Math.abs(value));
  return value < 0 ? `-${absolute}` : absolute;
}
