import type { Metadata } from "next";
import { TradeCard, type TradeCardProps } from "../../components/trade-card";

export const metadata: Metadata = {
  title: "Trade card - OG",
  robots: { index: false, follow: false },
};

/* OG canvas = 1200x630 (1.91:1). The card keeps its native 1690/944 ratio,
   scaled to fit the height (1128x630) and centered, leaving slim black side
   bars. Screenshot this route at a 1200x630 viewport for a pixel-perfect OG. */
const OG_W = 1200;
const OG_H = 630;
const CARD_W = Math.round((OG_H * 1690) / 944); // 1128 -> height lands on 630

const hyperliquid: TradeCardProps = {
  author: { name: "@CredibleCrypto", avatarUrl: "https://unavatar.io/x/CredibleCrypto" },
  trader: { name: "@0xWhaleHunter", avatarUrl: "https://unavatar.io/x/0xWhaleHunter" },
  headline: "ETH coiled under the range high while funding stayed flat.",
  tradeResult: {
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
    logoUrl: "/hyperliquid-logo.png",
  },
};

const EXAMPLES: Record<string, TradeCardProps> = {
  default: {},
  hyperliquid,
};

export default async function OgStagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pick = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const example = EXAMPLES[pick("ex") ?? "default"] ?? EXAMPLES.default;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: OG_W,
        height: OG_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#040504",
        overflow: "hidden",
      }}
    >
      <TradeCard frameWidth={CARD_W} {...example} />
    </div>
  );
}
