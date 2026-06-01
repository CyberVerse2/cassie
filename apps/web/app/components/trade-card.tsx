import styles from "./trade-card.module.css";

/* --- data model -----------------------------------------------
   Every value the card renders is a prop, so the component is
   reusable for any run. The defaults reproduce the @CryptoCapo_
   / "Bitcoin reaches $75k" example pixel-for-pixel. */

export type TradeCardThesis = {
  /** bold lead-in, e.g. "Target" */
  label: string;
  /** remainder of the line */
  text: string;
};

export type TradeCardPoint = {
  /** x in the 1690-unit design space */
  x: number;
  /** y in the 944-unit design space (0 = top) */
  y: number;
  /** label drawn at the node, e.g. "52c" */
  label: string;
  /** render the label below the node instead of above */
  labelBelow?: boolean;
};

export type TradeCardProps = {
  brand?: string;
  author?: {
    name: string;
    date: string;
    avatarUrl?: string;
  };
  headline?: string;
  thesis?: TradeCardThesis[];
  points?: TradeCardPoint[];
  pnl?: {
    label: string;
    percent: string;
    side: string;
    when: string;
    entry: string;
    exit: string;
  };
  market?: {
    venue: string;
    question: string;
    side: string;
    entry: string;
    exit: string;
    logoUrl?: string;
  };
  /** logo shown top-left; defaults to the Cassie wordmark asset */
  logoUrl?: string;
  /** layout: "split" = thesis left + PnL/chart card right;
      "band" = PnL hero top-right + full-width chart band */
  variant?: "split" | "band";
  /** override the frame width in px (height follows the 1690/944 ratio).
      Used by the OG stage to lock an exact capture size. */
  frameWidth?: number;
};

/** Generate a dense, organic price line: `n` points trending from
    `yStart` to `yEnd` (y: 0 = top), with layered sine + jitter wobble
    so it reads like a real tick feed. Deterministic (seeded). */
export function densePoints(opts: {
  n?: number;
  yStart?: number;
  yEnd?: number;
  amp?: number;
  seed?: number;
} = {}): TradeCardPoint[] {
  const { n = 160, yStart = 690, yEnd = 180, amp = 34, seed = 7 } = opts;
  const x0 = 95;
  const x1 = 1565;
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const pts: TradeCardPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = x0 + (x1 - x0) * t;
    const trend = yStart + (yEnd - yStart) * t;
    const wobble =
      Math.sin(t * 13 + seed) * amp +
      Math.sin(t * 37 + seed * 2) * amp * 0.45 +
      (rand() - 0.5) * amp * 1.1;
    pts.push({ x, y: trend + wobble, label: "" });
  }
  return pts;
}

const DEFAULT_POINTS: TradeCardPoint[] = densePoints();

const DEFAULTS = {
  brand: "Cassie",
  author: { name: "@CryptoCapo_", date: "Mar 6, 2026" },
  headline:
    "As long as price holds above $65k, I think we see $75k before the end of March. The structure here is the cleanest it's been all cycle.",
  thesis: [
    { label: "Target", text: "BTC $75k if $65k holds" },
    { label: "Market", text: "Bitcoin reaches $75k in March" },
    { label: "Trade", text: "YES from 52c to 100c" },
  ],
  points: DEFAULT_POINTS,
  pnl: {
    label: "Realized PnL",
    percent: "+94.2%",
    side: "YES",
    when: "1 wk ago",
    entry: "52c",
    exit: "100c",
  },
  market: {
    venue: "Polymarket",
    question: "Will Bitcoin reach $75,000 in March?",
    side: "YES",
    entry: "52c",
    exit: "100c",
    logoUrl: "/polymarket-logo.png",
  },
  logoUrl: "/cassie-logo-transparent.png",
};

/** Best-effort real avatar from an X handle, mirroring the landing page. */
function avatarFromHandle(name: string): string {
  const handle = name.replace(/^@/, "").trim();
  return `https://unavatar.io/x/${handle}`;
}

/* contained chart plot - fixed viewBox; the data is auto-scaled to fit,
   so a winning run rises and a losing run falls, both inside the box.
   "split" uses a tall box (right-hand card); "band" uses a wide box. */
const CHART_DIMS = {
  split: { cw: 1000, ch: 560, padX: 64, padTop: 88, padBottom: 76 },
  band: { cw: 1600, ch: 490, padX: 90, padTop: 70, padBottom: 78 },
} as const;

function Avatar({ name, url }: { name: string; url: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.avatar} src={url} alt={name} />;
}

/** Polymarket brand mark - blue rounded square with the white folded glyph. */
function PolymarketMark() {
  return (
    <span className={styles.venueMark} aria-hidden>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <linearGradient id="tc-pm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3050f7" />
            <stop offset="100%" stopColor="#1530d6" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="24" fill="url(#tc-pm)" />
        <g fill="#fff">
          <path d="M30 28h27l-12 18H30z" />
          <path d="M30 46h13l-12 18H30z" />
          <path d="M44 64h13V46H44z" opacity="0.55" />
          <path opacity="0.7" d="M57 28h13L46 64H35z" />
        </g>
      </svg>
    </span>
  );
}

export function TradeCard(props: TradeCardProps = {}) {
  const brand = props.brand ?? DEFAULTS.brand;
  const author: NonNullable<TradeCardProps["author"]> = props.author ?? DEFAULTS.author;
  const headline = props.headline ?? DEFAULTS.headline;
  const thesis = props.thesis ?? DEFAULTS.thesis;
  const points = props.points ?? DEFAULTS.points;
  const pnl = props.pnl ?? DEFAULTS.pnl;
  const market: NonNullable<TradeCardProps["market"]> = props.market ?? DEFAULTS.market;
  const logoUrl = props.logoUrl ?? DEFAULTS.logoUrl;
  const avatarUrl = author.avatarUrl ?? avatarFromHandle(author.name);
  const venueLogoUrl = market.logoUrl;

  const positive = pnl.percent.trim().startsWith("-") ? false : true;
  const variant = props.variant ?? "split";

  // auto-scale the points into the chosen chart box
  const dim = CHART_DIMS[variant];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number) => dim.padX + ((x - minX) / spanX) * (dim.cw - 2 * dim.padX);
  const sy = (y: number) => dim.padTop + ((y - minY) / spanY) * (dim.ch - dim.padTop - dim.padBottom);
  const mapped = points.map((p) => ({ ...p, cx: sx(p.x), cy: sy(p.y) }));
  const linePts = mapped.map((p) => `${p.cx},${p.cy}`).join(" ");
  const first = mapped[0];
  const last = mapped[mapped.length - 1];
  const areaPts = `${first.cx},${dim.ch} ${linePts} ${last.cx},${dim.ch}`;
  const baseY = first.cy; // entry reference line

  const chartSvg = (
    <svg
      className={styles.pnlChart}
      viewBox={`0 0 ${dim.cw} ${dim.ch}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {/* entry reference line */}
      <line
        x1={dim.padX - 18}
        y1={baseY}
        x2={dim.cw - dim.padX + 18}
        y2={baseY}
        className={styles.baseline}
      />
      <polygon points={areaPts} className={styles.areaFill} />
      <polyline points={linePts} className={styles.line} />

      {/* endpoint nodes only - entry dot and exit dot, no value labels */}
      <circle cx={first.cx} cy={first.cy} r={11} className={styles.nodeMajor} />
      <circle cx={last.cx} cy={last.cy} r={11} className={styles.nodeMajor} />
    </svg>
  );

  const statsBlock = (
    <>
      <span className={styles.pnlLabel}>{pnl.label}</span>
      <div className={styles.pnlValue}>{pnl.percent}</div>
      <div className={styles.pnlSub}>
        <span className={styles.sideBadge} data-positive={positive}>
          {pnl.side}
        </span>
        <span className={styles.pnlWhen}>{pnl.when}</span>
      </div>
    </>
  );

  return (
    <div
      className={styles.frame}
      data-positive={positive}
      data-variant={variant}
      style={props.frameWidth ? { width: props.frameWidth } : undefined}
    >
      <div className={styles.card}>
        {/* -- brand ----------------------------------------- */}
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.brandLogo} src={logoUrl} alt="" aria-hidden />
          <span className={styles.brandWord}>{brand}</span>
        </div>

        {/* -- source tweet ---------------------------------- */}
        <article className={styles.tweet}>
          <header className={styles.tweetHead}>
            <Avatar name={author.name} url={avatarUrl} />
            <div className={styles.tweetId}>
              <span className={styles.tweetName}>{author.name}</span>
              <span className={styles.tweetDate}>{author.date}</span>
            </div>
          </header>
          <h2 className={styles.headline}>&ldquo;{headline}&rdquo;</h2>
          <ol className={styles.thesis}>
            {thesis.map((row, i) => (
              <li key={row.label} className={styles.thesisRow}>
                <span className={styles.thesisNum}>{i + 1}</span>
                <span className={styles.thesisText}>
                  <b>{row.label}:</b> {row.text}
                </span>
              </li>
            ))}
          </ol>
        </article>

        {/* -- result zone (layout depends on variant) ------- */}
        {variant === "band" ? (
          <>
            <div className={styles.pnlStats} data-positive={positive}>
              {statsBlock}
            </div>
            <div className={styles.chartBand}>{chartSvg}</div>
          </>
        ) : (
          <aside className={styles.pnl} data-positive={positive}>
            <div className={styles.pnlHead}>{statsBlock}</div>
            <div className={styles.pnlChartWrap}>{chartSvg}</div>
          </aside>
        )}

        {/* -- venue / market footer ------------------------- */}
        <footer className={styles.market}>
          <div className={styles.venue}>
            {venueLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.venueMark} src={venueLogoUrl} alt={market.venue} />
            ) : (
              <PolymarketMark />
            )}
            <span className={styles.venueName}>{market.venue}</span>
          </div>
          <div className={styles.marketMain}>
            <span className={styles.marketKicker}>Market</span>
            <span className={styles.marketQuestion}>{market.question}</span>
          </div>
          <div className={styles.marketCell}>
            <span className={styles.marketKicker}>Side</span>
            <span className={styles.marketSide} data-positive={positive}>
              {market.side}
            </span>
          </div>
          <div className={styles.marketCell}>
            <span className={styles.marketKicker}>Entry</span>
            <span className={styles.marketMono}>{market.entry}</span>
          </div>
          <div className={styles.marketCell}>
            <span className={styles.marketKicker}>Exit</span>
            <span className={styles.marketMono}>{market.exit}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
