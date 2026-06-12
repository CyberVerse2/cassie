import styles from "./trade-card.module.css";

/* --- Trade result / PnL share card ----------------------------
   Clean dark card. One sans family, a heavy result-colored figure
   as the hero, and a Cassie judgment figure that bleeds across
   the surface. Carries two people: who called it (thesis) and who
   traded it. Fixed 1690x944 design, scaled fluidly via container-
   query units (1cqw = 1% of the card width). */

type Person = {
  name: string;
  avatarUrl?: string;
};

export type TradeCardProps = {
  brand?: string;
  /** who posted the thesis (the source call) */
  author?: Person;
  /** who executed the trade */
  trader?: Person;
  /** AI-written one-line hook for the call */
  headline?: string;
  tradeResult?: {
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
    logoUrl?: string;
  };
  /** override the frame width in px (height follows the 1690/944
      ratio). Used by the OG stage to lock an exact capture size. */
  frameWidth?: number;
};

const DEFAULTS = {
  brand: "Cassie",
  author: { name: "@CryptoCapo_", avatarUrl: "https://unavatar.io/x/CryptoCapo_" },
  trader: { name: "@0xWhaleHunter", avatarUrl: "https://unavatar.io/x/0xWhaleHunter" },
  headline: "Bitcoin reclaims the range high with funding flat.",
  tradeResult: {
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
    logoUrl: "/polymarket-logo.png",
  },
} satisfies Required<Omit<TradeCardProps, "frameWidth">>;

export function TradeCard(props: TradeCardProps) {
  const brand = props.brand ?? DEFAULTS.brand;
  const author = props.author ?? DEFAULTS.author;
  const trader = props.trader ?? DEFAULTS.trader;
  const headline = props.headline ?? DEFAULTS.headline;
  const result = props.tradeResult ?? DEFAULTS.tradeResult;
  const market = props.market ?? DEFAULTS.market;

  const positive = !result.percent.trim().startsWith("-");
  const label = `${market.venue} ${result.side} ${result.percent}`;

  return (
    <figure
      className={styles.frame}
      data-positive={positive}
      role="img"
      aria-label={label}
      style={props.frameWidth ? { width: `${props.frameWidth}px`, maxWidth: "none" } : undefined}
    >
      <div className={styles.card}>
        <img
          className={styles.judgment}
          src="/cassie-justice-scales.png"
          alt=""
          aria-hidden="true"
        />

        <div className={styles.content}>
          <header className={styles.head}>
            <div className={styles.brand}>
              <img className={styles.logo} src="/cassie-logo-transparent.png" alt="" />
              <span className={styles.wordmark}>{brand}</span>
            </div>
          </header>

          <div className={styles.people}>
            <Lockup label="Thesis" person={author} />
            <span className={styles.peopleArrow} aria-hidden="true">
              &rarr;
            </span>
            <Lockup label="Traded" person={trader} />
          </div>

          <div className={styles.identity}>
            <div className={styles.venueRow}>
              {market.logoUrl ? (
                <img className={styles.venueLogo} src={market.logoUrl} alt="" />
              ) : null}
              <span className={styles.venueName}>{market.venue}</span>
              <span className={styles.sideBadge}>{market.side}</span>
            </div>
            <p className={styles.question}>{market.question}</p>
          </div>

          <div className={styles.callout}>
            <p className={styles.headline}>{headline}</p>
          </div>

          <div className={styles.figureWrap}>
            <div className={styles.figure}>{result.percent}</div>
            <div className={styles.spec}>
              <div className={styles.specItem}>
                <span className={styles.specLabel}>Entry</span>
                <span className={styles.specValue}>{result.entry}</span>
              </div>
              <span className={styles.specArrow} aria-hidden="true">
                &rarr;
              </span>
              <div className={styles.specItem}>
                <span className={styles.specLabel}>Exit</span>
                <span className={styles.specValue}>{result.exit}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** A small labelled person: avatar + role + @handle. */
function Lockup({ label, person }: { label: string; person: Person }) {
  return (
    <div className={styles.lockup}>
      <Avatar person={person} />
      <div className={styles.lockupText}>
        <span className={styles.lockupLabel}>{label}</span>
        <span className={styles.lockupName}>{person.name}</span>
      </div>
    </div>
  );
}

function Avatar({ person }: { person: Person }) {
  if (person.avatarUrl) {
    return <img className={styles.avatar} src={person.avatarUrl} alt="" />;
  }
  const initial = person.name.replace(/^@/u, "").charAt(0).toUpperCase() || "?";
  return (
    <span className={styles.avatar} data-fallback="true" aria-hidden="true">
      {initial}
    </span>
  );
}
