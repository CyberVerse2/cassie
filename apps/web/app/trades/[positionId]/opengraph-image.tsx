import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getTradeShareData, TradeShareNotFoundError, type TradeShareData } from "../../lib/trade-card-data";

export const runtime = "nodejs";
export const alt = "Cassie trade result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type ImageProps = {
  params: Promise<{ positionId: string }>;
};

export default async function Image({ params }: ImageProps) {
  const { positionId } = await params;
  const share = await readShare(positionId);

  return new ImageResponse(<TradeOgImage share={share} />, size);
}

function TradeOgImage({ share }: { share: TradeShareData }) {
  const positive = share.pnlTone === "up";
  const accent = positive ? "#35d28b" : "#ef6b5a";
  const chartPoints = buildChartPoints(positive);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: "#040504",
        color: "#f0eadc",
        fontFamily: "Arial",
        padding: 32,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: "1px solid #8d6b28",
          borderRadius: 28,
          background: "linear-gradient(145deg, #11100b 0%, #050504 62%, #020202 100%)",
        }}
      />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginLeft: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              border: "1px solid #8d6b28",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#e4c86a",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            C
          </div>
          <div style={{ color: "#e4c86a", fontSize: 44, fontFamily: "Georgia", fontStyle: "italic" }}>Cassie</div>
        </div>

        <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 28 }}>
          <div
            style={{
              width: 540,
              height: 340,
              border: "1px solid #60491d",
              borderRadius: 20,
              background: "#090907",
              padding: 30,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  background: "#20180b",
                  border: "1px solid #8d6b28",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{share.cardProps.author?.name}</div>
                <div style={{ fontSize: 15, color: "#9e988b" }}>{share.cardProps.author?.date}</div>
              </div>
            </div>
            <div style={{ marginTop: 24, fontSize: 32, lineHeight: 1.16, fontFamily: "Georgia" }}>
              "{clampText(String(share.cardProps.headline ?? share.description), 150)}"
            </div>
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, fontSize: 22 }}>
              <div><b>Market:</b> {clampText(share.cardProps.market?.question ?? share.ticket.thesis, 44)}</div>
              <div><b>Trade:</b> {share.sideLabel} from {share.entryLabel} to {share.exitLabel}</div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", paddingTop: 44 }}>
            <div style={{ color: "#c9a847", fontSize: 18, letterSpacing: 6, fontWeight: 700 }}>{share.pnlLabel.toUpperCase()}</div>
            <div style={{ color: accent, fontSize: 96, lineHeight: 1, fontWeight: 800, marginTop: 18 }}>{share.pnlPercent}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18 }}>
              <div style={{ background: accent, color: "#05110b", borderRadius: 10, padding: "10px 18px", fontSize: 24, fontWeight: 800 }}>
                {share.sideLabel}
              </div>
              <div style={{ color: "#9e988b", fontSize: 22 }}>{share.cardProps.pnl?.when}</div>
            </div>
            <svg width="500" height="210" viewBox="0 0 500 210" style={{ marginTop: 26 }}>
              <polyline
                points={chartPoints}
                fill="none"
                stroke={accent}
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <div
          style={{
            height: 88,
            border: "1px solid #60491d",
            borderRadius: 18,
            background: "#090907",
            display: "flex",
            alignItems: "center",
            padding: "0 30px",
            gap: 24,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 800 }}>{share.venueLabel}</div>
          <div style={{ width: 1, height: 44, background: "#60491d" }} />
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ color: "#c9a847", fontSize: 14, letterSpacing: 3, fontWeight: 700 }}>POSITION</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{share.symbol} {share.sideLabel}</div>
          </div>
          <div style={{ color: accent, fontSize: 28, fontWeight: 800 }}>{share.position.status.toUpperCase()}</div>
        </div>
      </div>
    </div>
  );
}

async function readShare(positionId: string) {
  try {
    return await getTradeShareData(positionId);
  } catch (error) {
    if (error instanceof TradeShareNotFoundError) notFound();
    throw error;
  }
}

function buildChartPoints(positive: boolean) {
  return Array.from({ length: 24 }, (_, index) => {
    const t = index / 23;
    const x = 18 + t * 464;
    const trend = positive ? 168 - t * 124 : 54 + t * 124;
    const wobble = Math.sin(t * 16) * 12 + Math.sin(t * 39) * 5;
    return `${x.toFixed(1)},${(trend + wobble).toFixed(1)}`;
  }).join(" ");
}

function clampText(value: string, max: number) {
  const clean = value.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3).trim()}...`;
}
