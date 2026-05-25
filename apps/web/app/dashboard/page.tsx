"use client";

import { useState } from "react";

import tweetRun from "../../../../docs/test-run-tweets.json";
import s from "./dashboard.module.css";

const baseDepositAddress = "0x193c2109089dd260811f1852c9b1521d6ccf1c6b";
const baseDepositUri = `ethereum:${baseDepositAddress}@8453`;
const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=184x184&margin=8&data=${encodeURIComponent(baseDepositUri)}`;
const basescanUrl = `https://basescan.org/address/${baseDepositAddress}`;

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

const taggedTweets = tweetRun.tweets.slice(0, 6).map((tweet, index) => ({
  ...tweet,
  age: ["2h", "5h", "11h", "1d", "2d", "3d"][index] ?? tweet.date,
  preview: shortenTweet(tweet.text, 142),
}));

const ranges = ["1D", "1W", "1M", "1Y", "All"] as const;

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
      <a className={s.brand} href="/">
        <img className="mark" src="/cassie-logo-transparent.png" alt="" aria-hidden />
        <span>Cassie</span>
      </a>

      <div className={s.profile}>
        <span className={s.avatar}>C</span>
        <div className={s.profileText}>
          <span className="name">Celestine</span>
          <span className="handle">@thecyberverse1</span>
        </div>
      </div>

      <div className={s.depositCard} id="deposit">
        <div className={s.qrFrame}>
          <img src={qrSrc} alt="Base deposit QR code" />
        </div>
      </div>

      <div className={s.mentionRow}>
        <a className={`${s.btn} ${s.btnPrimary}`} href="#deposit">
          Deposit
        </a>
        <button
          className={`${s.btn} ${s.btnIcon}`}
          type="button"
          aria-label="Copy Base deposit address"
          onClick={copyAddress}
        >
          {copied ? (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--up)" }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      <div className={s.addr}>
        <span>{shortAddress(baseDepositAddress)} · Base</span>
        <a href={basescanUrl} target="_blank" rel="noreferrer" aria-label="View wallet on Basescan">
          ↗
        </a>
      </div>

      <nav className={s.nav} aria-label="Wallet actions">
        <a className={s.navLink} href="#deposit">
          Add money
          <span className="glyph">＋</span>
        </a>
        <a className={s.navLink} href="#send">
          Send money
          <span className="glyph">↗</span>
        </a>
        <a className={s.navLink} href="#swap">
          Swap money
          <span className="glyph">⇄</span>
        </a>
        <a className={s.navLink} href="#telegram">
          Telegram notifications
          <span className="glyph">✈</span>
        </a>
        <a className={s.navLink} href="#export-wallet">
          Export wallet
          <span className="glyph">↓</span>
        </a>
      </nav>

      <div className={s.asideFoot}>
        <span>Base wallet</span>
        <span className="help">?</span>
      </div>
    </aside>
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

  const rangeData = generateDataForRange(selectedRange);
  const currentValPoint = rangeData[rangeData.length - 1];
  const displayedPoint = hoveredData || currentValPoint;

  return (
    <section className={s.main}>
      <div className={s.tickerShell}>
        <div className={s.tickerStrip}>
          {[...tickerStrip, ...tickerStrip].map((t, i) => (
            <span className={s.tickerPill} key={`${t.sym}-${i}`}>
              <span className="tk-icon">{t.letter}</span>
              <span className="tk-sym">${t.sym}</span>
              <span className="tk-count">{t.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className={s.tabs} role="tablist">
        <button className={`${s.tab} ${s.tabActive}`} role="tab" aria-selected="true">
          Wallet
          <span className="tab-count">$1,284</span>
        </button>
        <button className={s.tab} role="tab" aria-selected="false">
          Trades
          <span className="tab-count">31</span>
        </button>
        <button className={s.tab} role="tab" aria-selected="false">
          Activity
        </button>
      </div>

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
                <span className={`side ${largestPortfolioMover.sideTone}`}>
                  {largestPortfolioMover.side}
                </span>
              </div>
              <div className={s.moverBody}>
                <div className={s.moverAssetInfo}>
                  <span className={s.tokenCell} style={{ position: "relative", width: "24px", height: "24px", display: "inline-flex", verticalAlign: "middle", margin: 0 }}>
                    <span className="tk" style={{ width: "24px", height: "24px", fontSize: "11px", fontWeight: "700" }}>{largestPortfolioMover.id[0]}</span>
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
                    {largestPortfolioMover.pnl}
                  </strong>
                  <span>{largestPortfolioMover.value} current</span>
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

        <div className={s.tableHeader}>
          <p>Recent trades</p>
        </div>

        <div className={s.table}>
          <div className={`${s.tr} ${s.thead}`} role="row">
            <span>Asset</span>
            <span>Trade</span>
            <span>Position</span>
            <span />
          </div>
          {trades.map((trade) => (
            <div className={s.tr} role="row" key={trade.title}>
              <span className={s.tokenCell}>
                <span className="tk">{trade.id[0]}</span>
                <span className={`tk-venue ${trade.venue}`} title={trade.venueLabel}>
                  <VenueIcon venue={trade.venue} size={11} />
                </span>
                <span className="entry-mark" />
              </span>
              <span className={s.tradeCopy}>
                <strong>{trade.title}</strong>
                <span>{trade.description}</span>
              </span>
              <span className={s.positionCell}>
                <strong>
                  <span className={`side ${trade.sideTone}`}>{trade.side}</span>
                  {trade.value}
                </strong>
                <span>
                  {trade.current} current · {trade.entry} entry
                </span>
              </span>
              <button className={s.menuBtn} aria-label="Open trade menu">⋯</button>
            </div>
          ))}
        </div>
      </div>
    </section>
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
          <span className="verified" aria-label="verified">✓</span>
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

function moneyToNumber(value: string) {
  return Number(value.replace(/[$,+]/g, ""));
}
