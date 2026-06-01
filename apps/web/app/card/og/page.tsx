import type { Metadata } from "next";
import { TradeCard, densePoints, type TradeCardProps } from "../../components/trade-card";

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
  const variant = pick("v") === "split" ? "split" : "band";
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
      <TradeCard variant={variant} frameWidth={CARD_W} {...example} />
    </div>
  );
}
