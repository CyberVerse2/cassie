"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";

import tweetRun from "../../../../docs/test-run-tweets.json";
import s from "./dashboard.module.css";

const baseDepositAddress = "0x193c2109089dd260811f1852c9b1521d6ccf1c6b";
const baseDepositUri = `ethereum:${baseDepositAddress}@8453`;
const basescanUrl = `https://basescan.org/address/${baseDepositAddress}`;

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
  { sym: "SOL", label: "22 trades", letter: "S" },
  { sym: "ETH", label: "14 trades", letter: "E" },
  { sym: "AI16Z", label: "35 trades", letter: "A" },
  { sym: "FED", label: "60 trades", letter: "F" },
  { sym: "BTC", label: "85 trades", letter: "B" },
  { sym: "HYPE", label: "73 trades", letter: "H" },
  { sym: "AVNT", label: "98 trades", letter: "A" },
  { sym: "GOLD", label: "41 trades", letter: "G" },
];

const trades = [
  {
    id: "SOL",
    title: "SOL ETF approval by quarter end",
    description: "Buy YES if approval odds pull back below 58c; cap exposure at $90 and exit above 68c.",
    venue: "poly",
    venueLabel: "Polymarket",
    confidence: "82%",
    instrument: "Prediction market",
    side: "YES",
    sideTone: "yes",
    entry: "58c",
    current: "63c",
    pnlPct: "+8.6%",
    value: "$91.40",
    pnl: "+$11.40",
    tone: "up",
  },
  {
    id: "ETH",
    title: "ETH momentum continuation",
    description: "Long ETH only while depth stays above 0.90 and funding remains below 0.02%.",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    confidence: "76%",
    instrument: "Perp",
    side: "LONG",
    sideTone: "long",
    entry: "$3,052",
    current: "$3,108",
    pnlPct: "+1.8%",
    value: "$124.70",
    pnl: "+$4.70",
    tone: "up",
  },
  {
    id: "FED",
    title: "Fed cut before September",
    description: "Hold YES exposure while CPI surprise remains negative and the market prices under 45%.",
    venue: "poly",
    venueLabel: "Polymarket",
    confidence: "73%",
    instrument: "Prediction market",
    side: "YES",
    sideTone: "yes",
    entry: "43c",
    current: "41c",
    pnlPct: "-4.7%",
    value: "$57.80",
    pnl: "-$2.20",
    tone: "down",
  },
  {
    id: "BTC",
    title: "BTC mean reversion",
    description: "Watch only. Enter if price returns to prior range high with clean liquidity above $104k.",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    confidence: "48%",
    instrument: "Perp",
    side: "SHORT",
    sideTone: "short",
    entry: "$103,200",
    current: "$101,840",
    pnlPct: "+1.3%",
    value: "$74.20",
    pnl: "+$5.90",
    tone: "up",
  },
  {
    id: "HYPE",
    title: "HYPE breakout continuation",
    description: "Long breakout while prior 14d resistance holds as support and volume stays above baseline.",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    confidence: "81%",
    instrument: "Perp",
    side: "LONG",
    sideTone: "long",
    entry: "$33.92",
    current: "$36.40",
    pnlPct: "+7.3%",
    value: "$103.74",
    pnl: "+$8.74",
    tone: "up",
  },
];

const largestPortfolioMover = trades.reduce((largest, trade) =>
  Math.abs(moneyToNumber(trade.pnl)) > Math.abs(moneyToNumber(largest.pnl))
    ? trade
    : largest,
);

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

const taggedTweets = tweetRun.tweets.slice(0, 6).map((tweet, index) => ({
  ...tweet,
  age: ["2h", "5h", "11h", "1d", "2d", "3d"][index] ?? tweet.date,
  preview: shortenTweet(tweet.text, 142),
}));

const ranges = ["1D", "1W", "1M", "1Y", "All"] as const;

const usdcIcon = "https://assets.coingecko.com/coins/images/6319/large/usdc.png";

type ActivityCommand = "trade" | "watch" | "counter";

type ActivityAsset = {
  sym: string;
  amount: string;
  value: string;
  icon: string;
};

type ActivityRow = {
  time: string;
  command: ActivityCommand;
  source: "cassie" | "x";
  from?: ActivityAsset;
  to?: ActivityAsset;
  target?: string;
  note?: string;
};

type ActivityGroup = {
  date: string;
  items: ActivityRow[];
};

const activityFeed: ActivityGroup[] = [
  {
    date: "May 26, 2026",
    items: [
      {
        time: "11:18am",
        command: "trade",
        source: "x",
        from: { sym: "USDC", amount: "-91.40", value: "$91.40", icon: usdcIcon },
        to: { sym: "SOL YES", amount: "+157.59", value: "$91.40", icon: tokenImages.SOL },
      },
      {
        time: "10:42am",
        command: "watch",
        source: "cassie",
        target: "BTC over $104,000",
        note: "Enter on clean liquidity break",
      },
    ],
  },
  {
    date: "May 25, 2026",
    items: [
      {
        time: "3:14pm",
        command: "counter",
        source: "x",
        from: { sym: "USDC", amount: "-57.80", value: "$57.80", icon: usdcIcon },
        to: { sym: "FED NO", amount: "+128.44", value: "$57.80", icon: tokenImages.FED },
      },
      {
        time: "1:50pm",
        command: "trade",
        source: "x",
        from: { sym: "USDC", amount: "-124.70", value: "$124.70", icon: usdcIcon },
        to: { sym: "ETH LONG", amount: "+0.040", value: "$124.70", icon: tokenImages.ETH },
      },
    ],
  },
  {
    date: "May 23, 2026",
    items: [
      {
        time: "2:13pm",
        command: "counter",
        source: "cassie",
        from: { sym: "USDC", amount: "-74.20", value: "$74.20", icon: usdcIcon },
        to: { sym: "BTC SHORT", amount: "+0.0007", value: "$74.20", icon: tokenImages.BTC },
      },
      {
        time: "9:31am",
        command: "watch",
        source: "x",
        target: "AI16Z mention spike",
        note: "Above 40 mentions / 15min",
      },
      {
        time: "8:08am",
        command: "trade",
        source: "x",
        from: { sym: "USDC", amount: "-103.74", value: "$103.74", icon: usdcIcon },
        to: { sym: "HYPE LONG", amount: "+2.852", value: "$103.74", icon: tokenImages.HYPE },
      },
    ],
  },
];

export default function Dashboard() {
  return (
    <main className={s.shell}>
      <Aside />
      <Center />
      <Voice />
    </main>
  );
}

function Aside() {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    await window.navigator.clipboard.writeText(baseDepositAddress);
  }

  return (
    <aside className={s.aside}>
      <a className={s.brand} href="/" aria-label="Cassie home">
        <img className="mark" src="/cassie-logo-transparent.png" alt="" aria-hidden />
        <span>Cassie</span>
      </a>

      <div className={s.depositCard} id="deposit">
        <div className={s.qrFrame}>
          <StyledQR data={baseDepositUri} />
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
          aria-label="Copy Base deposit address"
          title={copied ? "Copied" : "Copy address"}
        >
          <ActionIcon name={copied ? "check" : "copy"} />
        </button>
      </div>

      <Defaults />

      <nav className={s.nav} aria-label="Wallet actions">
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

        <span className={s.navSection}>Wallet</span>
        <a className={s.navLink} href="#export-wallet">
          <ActionIcon name="export" />
          <span>Export keys</span>
        </a>
      </nav>

      <div className={`${s.identity} ${s.identityDock}`}>
        <span className={s.identityAvatar}>C</span>
        <div className={s.identityText}>
          <span className={s.identityName}>Celestine</span>
          <span className={s.identityMeta}>@thecyberverse</span>
        </div>
      </div>
    </aside>
  );
}

function Defaults() {
  const [trade, setTrade] = useState("50");

  return (
    <label className={s.defaults}>
      <div className={s.defaultsHead}>
        <span className={s.defaultsLabel}>Default trade size</span>
        <span className={s.defaultsCaption}>per @cassie command</span>
      </div>
      <span className={s.defaultsField}>
        <span className={s.defaultsCurrency}>$</span>
        <input
          type="text"
          inputMode="decimal"
          className={s.defaultsInput}
          value={trade}
          onChange={(e) => setTrade(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label="Default trade size in USDC"
        />
      </span>
    </label>
  );
}

interface DataPoint {
  date: string;
  value: number;
  change: number;
}

function generateDataForRange(range: "1D" | "1W" | "1M" | "1Y" | "All"): DataPoint[] {
  let length = 80;
  let startVal = 1284.62;

  if (range === "1D") {
    length = 24;
    startVal = 1261.90;
  } else if (range === "1W") {
    length = 7;
    startVal = 1210.00;
  } else if (range === "1M") {
    length = 30;
    startVal = 1050.00;
  } else if (range === "1Y") {
    length = 52;
    startVal = 840.00;
  } else {
    length = 100;
    startVal = 500.00;
  }

  const data: DataPoint[] = [];
  const endVal = 1284.62;

  for (let i = 0; i < length; i++) {
    const t = i / (length - 1);
    let wave = 0;
    if (range === "1D") {
      wave = Math.sin(t * 8) * 12 + Math.cos(t * 15) * 6;
    } else if (range === "1W") {
      wave = Math.sin(t * 5) * 18 + Math.cos(t * 10) * 8;
    } else if (range === "1M") {
      wave = Math.sin(t * 7) * 45 + Math.cos(t * 14) * 20 + Math.sin(t * 3) * 10;
    } else if (range === "1Y") {
      wave = Math.sin(t * 10) * 80 + Math.cos(t * 5) * 40 - Math.sin(t * 22) * 15;
    } else {
      wave = Math.sin(t * 8) * 120 + Math.cos(t * 4) * 60 + Math.sin(t * 18) * 30;
    }

    const dampening = 1 - Math.pow(t, 4);
    const value = startVal + t * (endVal - startVal) + wave * dampening;
    const change = ((value - startVal) / startVal) * 100;

    let dateStr = "";
    const now = new Date(2026, 4, 26); // May 26, 2026
    if (range === "1D") {
      const hour = 24 - (length - 1 - i);
      dateStr = `${hour.toString().padStart(2, "0")}:00`;
    } else if (range === "1W") {
      const d = new Date(now);
      d.setDate(now.getDate() - (length - 1 - i));
      dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } else if (range === "1M") {
      const d = new Date(now);
      d.setDate(now.getDate() - (length - 1 - i));
      dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } else if (range === "1Y") {
      const d = new Date(now);
      d.setDate(now.getDate() - (length - 1 - i) * 7);
      dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } else {
      const d = new Date(now);
      d.setDate(now.getDate() - (length - 1 - i) * 5);
      dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    data.push({ date: dateStr, value, change });
  }

  data[data.length - 1] = {
    date: range === "1D" ? "24:00" : new Date(2026, 4, 26).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: endVal,
    change: ((endVal - startVal) / startVal) * 100
  };

  return data;
}

function Center() {
  const [selectedRange, setSelectedRange] = useState<"1D" | "1W" | "1M" | "1Y" | "All">("All");
  const [hoveredData, setHoveredData] = useState<DataPoint | null>(null);
  const [activeTab, setActiveTab] = useState<"wallet" | "activity">("wallet");
  const [walletView, setWalletView] = useState<"trades" | "watching">("trades");

  const rangeData = generateDataForRange(selectedRange);
  const currentValPoint = rangeData[rangeData.length - 1];
  const displayedPoint = hoveredData || currentValPoint;

  return (
    <section className={s.main}>
      <div className={s.tickerShell}>
        <div className={s.tickerStrip}>
          {[...tickerStrip, ...tickerStrip].map((t, i) => (
            <span className={s.tickerPill} key={`${t.sym}-${i}`}>
              <span className="tk-icon" style={{ overflow: "hidden", background: "none" }}>
                <img src={tickerImages[t.sym]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
          Wallet
          <span className="tab-count">$1,284</span>
        </button>
        <button
          type="button"
          className={`${s.tab} ${activeTab === "activity" ? s.tabActive : ""}`}
          role="tab"
          aria-selected={activeTab === "activity"}
          onClick={() => setActiveTab("activity")}
        >
          Activity
          <span className="tab-count">{activityFeed.reduce((n, g) => n + g.items.length, 0)}</span>
        </button>
      </div>

      {activeTab === "activity" && <ActivityPanel />}

      {activeTab === "wallet" && (
      <div className={s.content}>
        <header className={s.sectionHeader}>
          <h2>Wallet balance</h2>
          <p>Base USDC you deposit here funds Cassie trades across Polymarket and Hyperliquid.</p>
        </header>

        <div className={s.chartCard}>
          <div className={s.chartTop}>
            <span className={s.chartPrice}>
              ${displayedPoint.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className={`${s.deltaPill} ${displayedPoint.change >= 0 ? s.deltaUp : s.deltaDown}`}>
              {displayedPoint.change >= 0 ? "↑" : "↓"} {Math.abs(displayedPoint.change).toFixed(2)}%
            </span>
          </div>
          <div className={s.chartBody}>
            <LineChart data={rangeData} onHover={setHoveredData} />
          </div>
          <div className={s.chartFoot}>
            <div
              className={s.portfolioMover}
              aria-label={`${largestPortfolioMover.id} is the position with the largest portfolio change at ${largestPortfolioMover.pnl}`}
            >
              <div className={s.moverHeader}>
                <span className={s.moverLabel}>Largest position move</span>
              </div>
              <div className={s.moverBody}>
                <div className={s.moverAssetInfo}>
                  <span className={s.tokenCell} style={{ position: "relative", width: "24px", height: "24px", display: "inline-flex", verticalAlign: "middle", margin: 0 }}>
                    <span className="tk" style={{ width: "24px", height: "24px", fontSize: "11px", fontWeight: "700", overflow: "hidden", background: "none" }}>
                      <img src={tokenImages[largestPortfolioMover.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: "2px" }} />
                    </span>
                    <span className={`tk-venue ${largestPortfolioMover.venue}`} style={{ width: "12px", height: "12px", bottom: "-2px", left: "14px", border: "1.5px solid var(--bg-deep)" }}>
                      <VenueIcon venue={largestPortfolioMover.venue} size={7} />
                    </span>
                  </span>
                  <div className="mover-main">
                    <strong>{largestPortfolioMover.id}</strong>
                    <span>{largestPortfolioMover.title}</span>
                  </div>
                </div>
                <div className="mover-value">
                  <strong className={largestPortfolioMover.tone}>
                    <span className="mover-delta-icon" aria-hidden>
                      {largestPortfolioMover.tone === "up" ? "▲" : "▼"}
                    </span>
                    {largestPortfolioMover.pnl.replace(/^[+-]/, "")}
                  </strong>
                  <span>
                    <span className={`mover-side ${largestPortfolioMover.sideTone}`}>
                      {largestPortfolioMover.side}
                    </span>
                    <span className="mover-sep" aria-hidden>·</span>
                    {largestPortfolioMover.value}
                  </span>
                </div>
              </div>
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
              <div style={{ display: "inline-flex", position: "relative", width: "32px", height: "22px", marginRight: "6px" }}>
                <div style={{ position: "absolute", left: 0, top: "1px", zIndex: 2, background: "var(--panel)", border: "1.5px solid var(--panel)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px" }}>
                  <VenueIcon venue="hyper" size={12} />
                </div>
                <div style={{ position: "absolute", left: "12px", top: "1px", zIndex: 1, background: "var(--panel)", border: "1.5px solid var(--panel)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px" }}>
                  <VenueIcon venue="poly" size={12} />
                </div>
              </div>
              <span>Positions</span>
            </div>
            <div className={s.summaryCell}>
              <span className="label">Net Invested</span>
              <span className="value">$0.96</span>
            </div>
            <div className={s.summaryCell}>
              <span className="label">Realized</span>
              <span className="value">$0.01</span>
            </div>
            <div className={s.summaryCell}>
              <span className="label">Unrealized</span>
              <span className="value down">$-0.61</span>
            </div>
          </div>
        </div>

        <div className={s.walletSubtabs} role="tablist" aria-label="Wallet view">
          <button
            type="button"
            role="tab"
            aria-selected={walletView === "trades"}
            className={`${s.walletSubtab} ${walletView === "trades" ? s.walletSubtabActive : ""}`}
            onClick={() => setWalletView("trades")}
          >
            Trade history
            <span className={s.walletSubtabCount}>{trades.length}</span>
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
            <span>Trade</span>
            <span className={s.amountHead}>Amount</span>
            <span className={s.amountHead}>Value</span>
            <span />
          </div>
          {trades.map((trade) => (
            <div className={s.tr} role="row" key={trade.title}>
              <span className={s.tokenCell}>
                <span className="tk" style={{ overflow: "hidden", background: "none" }}>
                  <img src={tokenImages[trade.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: "4px" }} />
                </span>
                <span className={`tk-venue ${trade.venue}`} title={trade.venueLabel}>
                  <VenueIcon venue={trade.venue} size={11} />
                </span>
                <span className="entry-mark" />
              </span>
              <span className={s.tradeCopy}>
                <strong>{trade.title}</strong>
                <span>{trade.description}</span>
              </span>
              <span className={s.amountCell}>
                <span className={s.amountValue}>{trade.current.replace("c", "¢")}</span>
                <span
                  className={`${s.valueDelta} ${trade.tone === "up" ? s.amountUp : s.amountDown}`}
                >
                  <span className={s.amountDeltaIcon} aria-hidden>
                    {trade.tone === "up" ? "▲" : "▼"}
                  </span>
                  {trade.pnlPct.replace(/^[+-]/, "")}
                </span>
              </span>
              <span className={s.valueCell}>
                <span className={s.valuePrice}>{trade.value}</span>
                <span className={`${s.amountSide} ${s[`amountSide_${trade.sideTone}`]}`}>
                  {trade.side}
                </span>
              </span>
              <button className={s.menuBtn} aria-label="Open trade menu">⋯</button>
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
                <span className="tk" style={{ overflow: "hidden", background: "none" }}>
                  <img src={tokenImages[w.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: "4px" }} />
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

function ActivityPanel() {
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
        {activityFeed.map((group) => (
          <section className={s.activityGroup} key={group.date}>
            <h3 className={s.activityDate}>{group.date}</h3>
            <ul className={s.activityList}>
              {group.items.map((row, i) => (
                <ActivityItem row={row} key={`${group.date}-${i}`} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ActivityItem({ row }: { row: ActivityRow }) {
  return (
    <li className={s.activityRow}>
      <span className={`${s.activityCmdBadge} ${s[`activityCmd_${row.command}`]}`} aria-hidden>
        <CommandGlyph command={row.command} />
      </span>
      <div className={s.activityLabel}>
        <span className={s.activityCmd}>{row.command}</span>
        <span className={s.activityTime}>{row.time}</span>
      </div>

      {row.from && row.to ? (
        <>
          <div className={s.activityAsset}>
            <span className={s.activityAssetIcon}>
              <img src={row.from.icon} alt="" aria-hidden />
            </span>
            <div className={s.activityAssetText}>
              <strong>
                {row.from.amount} <span className={s.activityAssetSym}>{row.from.sym}</span>
              </strong>
              <span>{row.from.value}</span>
            </div>
          </div>
          <span className={s.activityArrow} aria-hidden>→</span>
          <div className={s.activityAsset}>
            <span className={s.activityAssetIcon}>
              <img src={row.to.icon} alt="" aria-hidden />
            </span>
            <div className={s.activityAssetText}>
              <strong className={s.activityAssetTo}>
                {row.to.amount} <span className={s.activityAssetSym}>{row.to.sym}</span>
              </strong>
              <span>{row.to.value}</span>
            </div>
          </div>
        </>
      ) : (
        <div className={s.activityWatch}>
          <strong>{row.target}</strong>
          {row.note && <span>{row.note}</span>}
        </div>
      )}

      <span className={s.activitySources}>
        <span className={s.activitySourceChip} title="Cassie">
          <img src="/cassie-logo-transparent.png" alt="Cassie" />
        </span>
        {row.source === "x" && (
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

function CommandGlyph({ command }: { command: ActivityCommand }) {
  if (command === "trade") {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    );
  }
  if (command === "watch") {
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
          <span className="handle">@cassie</span>
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
              <span className="tk">@cassie</span>: {tweet.cassiePrompt}
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

  const xAt = (i: number) => pad.l + (i / (data.length - 1)) * innerW;
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

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * w;

    const xPercent = svgX / w;
    const dataIndex = Math.max(0, Math.min(data.length - 1, Math.round(xPercent * (data.length - 1))));

    setHoveredIndex(dataIndex);
    onHover(data[dataIndex]);
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    onHover(null);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.touches[0].clientX - rect.left;
    const svgX = (mouseX / rect.width) * w;

    const xPercent = svgX / w;
    const dataIndex = Math.max(0, Math.min(data.length - 1, Math.round(xPercent * (data.length - 1))));

    setHoveredIndex(dataIndex);
    onHover(data[dataIndex]);
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchMove}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseLeave}
        aria-label="Base wallet balance history"
      >
        <defs>
          <linearGradient id="walletFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-a)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--series-a)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal Gridlines */}
        <line x1="0" y1={pad.t + innerH * 0.25} x2={w} y2={pad.t + innerH * 0.25} className={s.chartGrid} />
        <line x1="0" y1={pad.t + innerH * 0.5} x2={w} y2={pad.t + innerH * 0.5} className={s.chartGrid} />
        <line x1="0" y1={pad.t + innerH * 0.75} x2={w} y2={pad.t + innerH * 0.75} className={s.chartGrid} />

        {/* Gridline Labels */}
        <text x="8" y={pad.t + innerH * 0.25 - 6} fill="var(--ink-faint)" fontSize="10" fontFamily="var(--stack-sans)" fontWeight="500">
          ${formatAxisValue(chartMax - (chartMax - chartMin) * 0.25)}
        </text>
        <text x="8" y={pad.t + innerH * 0.5 - 6} fill="var(--ink-faint)" fontSize="10" fontFamily="var(--stack-sans)" fontWeight="500">
          ${formatAxisValue(chartMax - (chartMax - chartMin) * 0.5)}
        </text>
        <text x="8" y={pad.t + innerH * 0.75 - 6} fill="var(--ink-faint)" fontSize="10" fontFamily="var(--stack-sans)" fontWeight="500">
          ${formatAxisValue(chartMax - (chartMax - chartMin) * 0.75)}
        </text>

        {/* Area Gradient Fill */}
        <path d={areaPath} className={s.chartFill} />

        {/* Thick line glow underlay */}
        <path d={mainPath} className={s.chartGlow} />

        {/* Crisp balance line */}
        <path d={mainPath} className={s.chartLine} />

        {/* Cursor & Tracker elements */}
        {hoveredIndex !== null && (
          <>
            {/* Vertical Cursor Guide */}
            <line
              x1={xAt(hoveredIndex)}
              y1={0}
              x2={xAt(hoveredIndex)}
              y2={h}
              className={s.chartCursorLine}
            />
            {/* Cursor Dot outer ring */}
            <circle
              cx={xAt(hoveredIndex)}
              cy={yAt(values[hoveredIndex])}
              r="7"
              className={s.chartCursorDot}
              style={{ filter: "drop-shadow(0 0 4px var(--series-a))" }}
            />
            {/* Cursor Dot inner core */}
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
  style?: React.CSSProperties;
}

type ActionIconName = "deposit" | "copy" | "check" | "send" | "swap" | "telegram" | "export";

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

  return (
    <svg {...common}>
      <path d="M12 14V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M5 18h14" />
    </svg>
  );
}

function VenueIcon({ venue, size = 16, className, style }: VenueIconProps) {
  if (venue === "hyper") {
    return (
      <svg
        viewBox="0 0 144 144"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ ...style }}
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
        style={{ ...style }}
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

function shortenTweet(text: string, maxLength: number) {
  const clean = text
    .replace(/https:\/\/t\.co\/\S+/g, "")
    .replace(/pic\.twitter\.com\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return clean.length > maxLength
    ? `${clean.slice(0, maxLength - 3).trim()}...`
    : clean;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function StyledQR({ data, size = 132 }: { data: string; size?: number }) {
  const matrix = useMemo(() => {
    const qr = QRCode.create(data, { errorCorrectionLevel: "H" });
    return { modules: qr.modules, count: qr.modules.size };
  }, [data]);

  const { modules, count } = matrix;
  const cell = size / count;
  const r = cell * 0.42;

  const finders = [
    { x: 0, y: 0 },
    { x: count - 7, y: 0 },
    { x: 0, y: count - 7 },
  ];
  const inFinder = (x: number, y: number) =>
    finders.some((f) => x >= f.x && x < f.x + 7 && y >= f.y && y < f.y + 7);

  const logoModules = Math.max(5, Math.round(count * 0.18));
  const logoStart = Math.floor((count - logoModules) / 2);
  const logoEnd = logoStart + logoModules;
  const inLogo = (x: number, y: number) =>
    x >= logoStart && x < logoEnd && y >= logoStart && y < logoEnd;

  const dots: JSX.Element[] = [];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (inFinder(x, y) || inLogo(x, y)) continue;
      if (modules.get(x, y)) {
        dots.push(
          <circle
            key={`${x}-${y}`}
            cx={(x + 0.5) * cell}
            cy={(y + 0.5) * cell}
            r={r}
            fill="#0a0a0a"
          />,
        );
      }
    }
  }

  const logoX = logoStart * cell;
  const logoY = logoStart * cell;
  const logoW = logoModules * cell;
  const pad = cell * 0.7;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Base deposit QR code"
    >
      <rect width={size} height={size} rx={size * 0.06} fill="#ffffff" />
      {finders.map((f, i) => {
        const fx = f.x * cell;
        const fy = f.y * cell;
        const fs = 7 * cell;
        return (
          <g key={`finder-${i}`}>
            <rect x={fx} y={fy} width={fs} height={fs} rx={fs * 0.26} fill="#0a0a0a" />
            <rect
              x={fx + cell}
              y={fy + cell}
              width={fs - 2 * cell}
              height={fs - 2 * cell}
              rx={(fs - 2 * cell) * 0.24}
              fill="#ffffff"
            />
            <rect
              x={fx + 2 * cell}
              y={fy + 2 * cell}
              width={fs - 4 * cell}
              height={fs - 4 * cell}
              rx={(fs - 4 * cell) * 0.26}
              fill="#0a0a0a"
            />
          </g>
        );
      })}
      {dots}
      <rect
        x={logoX - pad}
        y={logoY - pad}
        width={logoW + pad * 2}
        height={logoW + pad * 2}
        rx={cell * 0.6}
        fill="#ffffff"
      />
      <rect
        x={logoX}
        y={logoY}
        width={logoW}
        height={logoW}
        rx={cell * 0.35}
        fill="#0052FF"
      />
    </svg>
  );
}

function moneyToNumber(value: string) {
  return Number(value.replace(/[$,+]/g, ""));
}
