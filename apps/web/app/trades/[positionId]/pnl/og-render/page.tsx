import { notFound } from "next/navigation";
import { getTradeShareData, TradeShareNotFoundError } from "../../../../lib/trade-card-data";
import { TradeShareClient } from "../../trade-share-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OgRenderPageProps = {
  params: Promise<{ positionId: string }>;
};

export default async function TradePnlOgRenderPage({ params }: OgRenderPageProps) {
  const { positionId } = await params;
  const share = await readShare(positionId);

  return (
    <main
      data-og-render-ready="true"
      style={{
        width: 1200,
        height: 630,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        background: "#040504",
      }}
    >
      <TradeShareClient initialShare={share} frameWidth={1110} />
    </main>
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
