import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TradeCard, type TradeCardProps } from "../components/trade-card";
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

const hyperliquidWin: TradeCardProps = {
  author: { name: "@CredibleCrypto", avatarUrl: "https://unavatar.io/x/CredibleCrypto" },
  trader: { name: "@0xWhaleHunter", avatarUrl: "https://unavatar.io/x/0xWhaleHunter" },
  headline: "ETH coiled under the range high while funding stayed flat.",
  tradeResult: {
    percent: "+221.4%",
    side: "LONG",
    when: "3 days ago",
    entry: "$2,980.00",
    exit: "$3,640.00",
  },
  market: {
    venue: "Hyperliquid",
    question: "ETH-PERP - 10x Long",
    side: "LONG",
    logoUrl: "/hyperliquid-logo.png",
  },
};

const hyperliquidLoss: TradeCardProps = {
  author: { name: "@DeFiDegen", avatarUrl: "https://unavatar.io/x/DeFiDegen" },
  trader: { name: "@apescout", avatarUrl: "https://unavatar.io/x/apescout" },
  headline: "The dip-buy missed confirmation and ETH broke lower.",
  tradeResult: {
    percent: "-72.3%",
    side: "LONG",
    when: "1 wk ago",
    entry: "$3,180.00",
    exit: "$2,720.00",
  },
  market: {
    venue: "Hyperliquid",
    question: "ETH-PERP - 5x Long",
    side: "LONG",
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
      <Label>Default</Label>
      <TradeCard />

      <Label>Win - Hyperliquid</Label>
      <TradeCard {...hyperliquidWin} />

      <Label>Loss - Hyperliquid</Label>
      <TradeCard {...hyperliquidLoss} />
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
