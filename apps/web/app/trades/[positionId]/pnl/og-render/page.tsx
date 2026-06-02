import { notFound } from "next/navigation";
import { TradeCard } from "../../../../components/trade-card";
import { getTradeCardRenderData, TradeShareNotFoundError } from "../../../../lib/trade-card-data";

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
      <TradeCard {...share.cardProps} frameWidth={1200} />
    </main>
  );
}

async function readShare(positionId: string) {
  try {
    return await getTradeCardRenderData(positionId);
  } catch (error) {
    if (error instanceof TradeShareNotFoundError) notFound();
    throw error;
  }
}
