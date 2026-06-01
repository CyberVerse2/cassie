import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TradeCard, densePoints, type TradeCardProps } from "../components/trade-card";
import { siteDescription, siteName, tradeCardSocialImage } from "../metadata-config";

export const metadata: Metadata = {
  title: "Trade card",
  description: siteDescription,
  openGraph: {
    type: "website",
    title: "Cassie trade card",
    description: siteDescription,
    siteName,
    images: [tradeCardSocialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cassie trade card",
    description: siteDescription,
    images: [tradeCardSocialImage.url],
  },
  robots: { index: false, follow: false },
};

/** Hyperliquid perps example - directional LONG with leverage, USD prices. */
const hyperliquid: TradeCardProps = {
  author: { name: "@CredibleCrypto", date: "Apr 2, 2026" },
  headline:
    "ETH is coiling right under range high and I'm long here with a tight stop. Funding is flat, OI is building - this resolves up.",
  thesis: [
    { label: "Target", text: "ETH reclaims $3,600" },
    { label: "Market", text: "ETH-PERP - 10x Long" },
    { label: "Trade", text: "Long from $2,980 to $3,640" },
  ],
  points: densePoints({ yStart: 690, yEnd: 150, seed: 11 }),
  pnl: {
    label: "Realized PnL",
    percent: "+221.4%",
    side: "LONG",
    when: "3 days ago",
    entry: "$2,980",
    exit: "$3,640",
  },
  market: {
    venue: "Hyperliquid",
    question: "ETH-PERP - 10x Long",
    side: "LONG",
    entry: "$2,980",
    exit: "$3,640",
    logoUrl: "/hyperliquid-logo.png",
  },
};

/** Losing Hyperliquid LONG - price fell against the position, so the line
    descends (line direction = the trade's outcome, not raw price action). */
const hyperliquidLoss: TradeCardProps = {
  author: { name: "@DeFiDegen", date: "Feb 18, 2026" },
  headline: "Buying this dip - bounce is right here, full size.",
  thesis: [
    { label: "Target", text: "ETH bounces to $3,400" },
    { label: "Market", text: "ETH-PERP - 5x Long" },
    { label: "Trade", text: "Long from $3,180, stopped at $2,720" },
  ],
  points: densePoints({ yStart: 250, yEnd: 720, seed: 19 }),
  pnl: {
    label: "Realized PnL",
    percent: "-72.3%",
    side: "LONG",
    when: "1 wk ago",
    entry: "$3,180",
    exit: "$2,720",
  },
  market: {
    venue: "Hyperliquid",
    question: "ETH-PERP - 5x Long",
    side: "LONG",
    entry: "$3,180",
    exit: "$2,720",
    logoUrl: "/hyperliquid-logo.png",
  },
};

export default function CardPreviewPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        gap: "clamp(24px, 4vw, 56px)",
        padding: "clamp(16px, 4vw, 64px)",
        background: "#040504",
      }}
    >
      <Label>Split - thesis left - PnL + chart right</Label>
      <TradeCard variant="split" />
      <TradeCard variant="split" {...hyperliquid} />
      <TradeCard variant="split" {...hyperliquidLoss} />

      <Label>Hero band - PnL top-right - full-width chart</Label>
      <TradeCard variant="band" />
      <TradeCard variant="band" {...hyperliquid} />
      <TradeCard variant="band" {...hyperliquidLoss} />
    </main>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        margin: "clamp(16px, 3vw, 40px) 0 0",
        color: "oklch(0.72 0.1 82)",
        font: "600 13px/1.2 ui-sans-serif, system-ui, sans-serif",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </h2>
  );
}
