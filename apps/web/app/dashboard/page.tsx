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
    position: "Bought $80 -> $91.40",
    price: "YES 63c · entry 58c",
    tone: "up",
  },
  {
    id: "ETH",
    title: "ETH momentum continuation",
    description: "Long ETH only while depth stays above 0.90 and funding remains below 0.02%.",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    confidence: "76%",
    position: "Bought $120 -> $124.70",
    price: "$3,108 · entry $3,052",
    tone: "up",
  },
  {
    id: "FED",
    title: "Fed cut before September",
    description: "Hold YES exposure while CPI surprise remains negative and the market prices under 45%.",
    venue: "poly",
    venueLabel: "Polymarket",
    confidence: "73%",
    position: "Bought $60 -> $57.80",
    price: "YES 41c · entry 43c",
    tone: "down",
  },
  {
    id: "BTC",
    title: "BTC mean reversion",
    description: "Watch only. Enter if price returns to prior range high with clean liquidity above $104k.",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    confidence: "48%",
    position: "Bought $0 -> $0",
    price: "$101,840 · no entry",
    tone: "neutral",
  },
  {
    id: "HYPE",
    title: "HYPE breakout continuation",
    description: "Long breakout while prior 14d resistance holds as support and volume stays above baseline.",
    venue: "hyper",
    venueLabel: "Hyperliquid",
    confidence: "81%",
    position: "Bought $95 -> $103.74",
    price: "$36.40 · entry $33.92",
    tone: "up",
  },
];

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
        <div className={s.depositMeta}>
          <span className="label">Base deposit address</span>
          <span className="address">{shortAddress(baseDepositAddress)}</span>
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
          {copied ? "✓" : "⧉"}
        </button>
      </div>

      <div className={s.addr}>
        <span>{shortAddress(baseDepositAddress)} · Base</span>
        <a href={basescanUrl} target="_blank" rel="noreferrer" aria-label="View wallet on Basescan">
          ↗
        </a>
      </div>

      <nav className={s.nav} aria-label="Wallet actions">
        <a className={s.navLink} href={basescanUrl} target="_blank" rel="noreferrer">
          View on Basescan
          <span className="glyph">↗</span>
        </a>
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

function Center() {
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
            <span className={s.chartPrice}>$1,284.62</span>
            <span className={`${s.deltaPill} ${s.deltaUp}`}>↑ 1.8%</span>
          </div>
          <div className={s.chartBody}>
            <LineChart />
          </div>
          <div className={s.chartFoot}>
            <div className={s.legend}>
              <span><span className="swatch sw-a" /> Base USDC</span>
              <span><span className="swatch sw-b" /> Open trade value</span>
            </div>
            <div className={s.ranges}>
              {ranges.map((r) => (
                <button
                  key={r}
                  className={`${s.rangeBtn} ${r === "All" ? s.rangeActive : ""}`}
                >
                  {r}
                </button>
              ))}
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
            <span style={{ textAlign: "right" }}>Confidence</span>
            <span />
          </div>
          {trades.map((trade) => (
            <div className={s.tr} role="row" key={trade.title}>
              <span className={s.tokenCell}>
                <span className="tk">{trade.id[0]}</span>
                <span className={`tk-venue ${trade.venue}`} title={trade.venueLabel} />
                <span className="entry-mark" />
              </span>
              <span className={s.tradeCopy}>
                <strong>{trade.title}</strong>
                <span>{trade.description}</span>
              </span>
              <span className={s.positionCell}>
                <strong>{trade.position}</strong>
                <span>{trade.price}</span>
              </span>
              <span className={s.deltaCell}>
                {trade.confidence}
                <span className={`delta ${trade.tone}`}>{trade.tone === "neutral" ? "watching" : trade.tone}</span>
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

function LineChart() {
  const w = 1080;
  const h = 280;
  const pad = { l: 8, r: 8, t: 16, b: 16 };
  const n = 80;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const seedA = (i: number) =>
    0.5 + i * 0.012 + Math.sin(i * 0.31) * 0.18 + Math.cos(i * 0.09) * 0.12;
  const seedB = (i: number) =>
    0.35 + i * 0.008 + Math.sin(i * 0.27 + 1.3) * 0.14 + Math.cos(i * 0.11) * 0.1;

  const seriesA = Array.from({ length: n }, (_, i) => seedA(i));
  const seriesB = Array.from({ length: n }, (_, i) => seedB(i));
  const all = [...seriesA, ...seriesB];
  const min = Math.min(...all) - 0.15;
  const max = Math.max(...all) + 0.15;

  const xAt = (i: number) => pad.l + (i / (n - 1)) * innerW;
  const yAt = (v: number) =>
    pad.t + innerH - ((v - min) / (max - min)) * innerH;

  const pathOf = (values: number[]) => {
    let d = "";
    for (let i = 0; i < values.length; i++) {
      const x = xAt(i);
      const y = yAt(values[i]);
      if (i === 0) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
      else {
        const px = xAt(i - 1);
        const py = yAt(values[i - 1]);
        const cx = px + (x - px) / 2;
        d += ` C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
      }
    }
    return d;
  };

  const pathA = pathOf(seriesA);
  const pathB = pathOf(seriesB);
  const areaA = `${pathA} L${xAt(n - 1).toFixed(1)},${(h - pad.b).toFixed(1)} L${xAt(0).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-label="Base wallet balance history">
      <defs>
        <linearGradient id="walletFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--gilt)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--gilt)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaA} fill="url(#walletFill)" />
      <path d={pathA} fill="none" stroke="var(--series-a)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={pathB} fill="none" stroke="var(--series-b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
