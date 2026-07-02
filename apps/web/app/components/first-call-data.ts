// Curated replay scenarios for the first-call intro. Each one mirrors a real
// supervisor pipeline run (stepTypes match packages/agent/pipeline.ts) so the
// replay reads like the worker, not a marketing animation.
//
// NOTE: stage bodies and outcomes are authored placeholders. Swap them for
// real persisted run traces (agent_run_steps) before shipping to production.

export type ReplayStage = {
  stepType: string;
  label: string;
  body: string;
  ms: number;
};

export type ReplayResult = {
  side: string;
  symbol: string;
  venue: "Hyperliquid" | "Polymarket";
  detail: string;
  entry: string;
  exit: string;
  pnlPct: number;
  holdDays: number;
  thesis: string;
};

export type FirstCallScenario = {
  id: string;
  authorName: string;
  handle: string;
  avatarUrl: string;
  date: string;
  text: string;
  url: string;
  stages: ReplayStage[];
  result: ReplayResult;
};

export const FIRST_CALL_PROMPT = "@cassiedottrade trade this";

export const firstCallScenarios: FirstCallScenario[] = [
  {
    id: "eth-rotation",
    authorName: "Token Terminal 📊",
    handle: "@tokenterminal",
    avatarUrl: "https://unavatar.io/x/tokenterminal",
    date: "May 21",
    text: "Ethereum is losing the race among L1s.",
    url: "https://x.com/tokenterminal/status/2057569804265857269",
    stages: [
      {
        stepType: "intake",
        label: "Reading the post",
        body: "Relative-strength take: ETH losing share vs other L1s. Chart-backed claim, no timeframe given.",
        ms: 1400,
      },
      {
        stepType: "context_discovery",
        label: "Searching X for context",
        body: "41 related posts in 48h. L1 rotation narrative building; ETH/SOL ratio at a 14-month low; no near-term ETH catalyst flagged.",
        ms: 2200,
      },
      {
        stepType: "opportunity",
        label: "Framing the opportunity",
        body: "If rotation persists, ETH underperforms majors near-term. Horizon: days to weeks. Conviction: moderate.",
        ms: 1900,
      },
      {
        stepType: "trade_expression",
        label: "Choosing the expression",
        body: "Highest-purity expression: short ETH outright. Rejected: long SOL (imports a second thesis), ETH/BTC ratio (no clean venue).",
        ms: 1900,
      },
      {
        stepType: "market_candidates",
        label: "Searching venues",
        body: "Hyperliquid: ETH perp, deep book. Polymarket: 2 adjacent markets, weak semantic fit. 3 candidates.",
        ms: 1600,
      },
      {
        stepType: "market_assessment",
        label: "Assessing fit",
        body: "ETH perp — fit 0.86, direct and liquid. “ETH above $3k by July?” — fit 0.41, timeframe mismatch. 1 validated.",
        ms: 1800,
      },
      {
        stepType: "market_selection",
        label: "Quote & selection",
        body: "ETH perp mid $2,412.40 · spread 0.4 bps · selected.",
        ms: 1300,
      },
      {
        stepType: "ticket",
        label: "Cutting the ticket",
        body: "SHORT ETH · $25 margin · 3x · TP +10% / SL −5% · max hold 7 days.",
        ms: 1500,
      },
    ],
    result: {
      side: "SHORT",
      symbol: "ETH",
      venue: "Hyperliquid",
      detail: "3x perp · $25 margin",
      entry: "$2,412",
      exit: "$2,338",
      pnlPct: 9.2,
      holdDays: 4,
      thesis: "L1 rotation: ETH underperforms majors near-term.",
    },
  },
  {
    id: "hype-alive",
    authorName: "David Hoffman",
    handle: "@TrustlessState",
    avatarUrl: "https://unavatar.io/x/TrustlessState",
    date: "May 9",
    text: "$ZEC $HYPE $VVV $NEAR\n\nMost alive tokens in crypto rn",
    url: "https://x.com/TrustlessState/status/2053174322655641967",
    stages: [
      {
        stepType: "intake",
        label: "Reading the post",
        body: "Momentum basket call: four tokens named as “most alive.” No sizing, no timeframe — vibes with a list.",
        ms: 1400,
      },
      {
        stepType: "context_discovery",
        label: "Searching X for context",
        body: "HYPE has the strongest tape of the four: buyback narrative, rising open interest, 3 large accounts turned bullish this week.",
        ms: 2200,
      },
      {
        stepType: "opportunity",
        label: "Framing the opportunity",
        body: "Momentum continuation on the strongest name rather than the basket. Horizon: about a week. Conviction: moderate-high.",
        ms: 1900,
      },
      {
        stepType: "trade_expression",
        label: "Choosing the expression",
        body: "Long HYPE outright. Rejected: equal-weight basket (dilutes the one clean signal), ZEC (crowded after its run).",
        ms: 1900,
      },
      {
        stepType: "market_candidates",
        label: "Searching venues",
        body: "Hyperliquid: HYPE perp, native venue, deepest book. 2 candidates.",
        ms: 1600,
      },
      {
        stepType: "market_assessment",
        label: "Assessing fit",
        body: "HYPE perp — fit 0.91, direct expression on the native venue. 1 validated.",
        ms: 1800,
      },
      {
        stepType: "market_selection",
        label: "Quote & selection",
        body: "HYPE perp mid $42.18 · spread 0.6 bps · selected.",
        ms: 1300,
      },
      {
        stepType: "ticket",
        label: "Cutting the ticket",
        body: "LONG HYPE · $25 margin · 3x · TP +10% / SL −5% · max hold 7 days.",
        ms: 1500,
      },
    ],
    result: {
      side: "LONG",
      symbol: "HYPE",
      venue: "Hyperliquid",
      detail: "3x perp · $25 margin",
      entry: "$42.18",
      exit: "$44.71",
      pnlPct: 18.0,
      holdDays: 6,
      thesis: "Momentum continuation on the strongest of the four names.",
    },
  },
  {
    id: "saylor-sell",
    authorName: "Kalshi Crypto",
    handle: "@Kalshi_Crypto",
    avatarUrl: "https://unavatar.io/x/Kalshi_Crypto",
    date: "May 21",
    text: "BREAKING: Michael Saylor says 'Strategy' will likely sell Bitcoin this year",
    url: "https://x.com/Kalshi_Crypto/status/2057447510235299970",
    stages: [
      {
        stepType: "intake",
        label: "Reading the post",
        body: "News event: Saylor signals Strategy may sell BTC this year. Binary, dated claim — prediction-market shaped.",
        ms: 1400,
      },
      {
        stepType: "context_discovery",
        label: "Searching X for context",
        body: "Quote confirmed from the live interview. Market hasn't fully repriced: most reactions treat it as a bluff.",
        ms: 2200,
      },
      {
        stepType: "opportunity",
        label: "Framing the opportunity",
        body: "If the quote is genuine guidance, “Strategy sells BTC in 2026” is underpriced. Horizon: event-driven. Conviction: moderate.",
        ms: 1900,
      },
      {
        stepType: "trade_expression",
        label: "Choosing the expression",
        body: "Buy YES on the resolution market. Rejected: short BTC (indirect — a sale is announced long before it moves spot).",
        ms: 1900,
      },
      {
        stepType: "market_candidates",
        label: "Searching venues",
        body: "Polymarket: “Will Strategy sell any BTC in 2026?” — exact-match resolution. 1 candidate.",
        ms: 1600,
      },
      {
        stepType: "market_assessment",
        label: "Assessing fit",
        body: "Resolution wording matches the claim one-to-one — fit 0.94. 1 validated.",
        ms: 1800,
      },
      {
        stepType: "market_selection",
        label: "Quote & selection",
        body: "YES at 34¢ · $18k book depth · selected.",
        ms: 1300,
      },
      {
        stepType: "ticket",
        label: "Cutting the ticket",
        body: "BUY YES · $25 · exit on repricing or resolution · max hold to resolution.",
        ms: 1500,
      },
    ],
    result: {
      side: "YES",
      symbol: "Strategy sells BTC in 2026",
      venue: "Polymarket",
      detail: "$25 at 34¢",
      entry: "34¢",
      exit: "47¢",
      pnlPct: 38.2,
      holdDays: 9,
      thesis: "Genuine guidance, priced as a bluff.",
    },
  },
];
