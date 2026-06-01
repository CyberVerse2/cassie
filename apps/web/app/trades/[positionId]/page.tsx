import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradeCard } from "../../components/trade-card";
import { getTradeShareData, TradeShareNotFoundError } from "../../lib/trade-card-data";
import { siteName, siteUrl } from "../../metadata-config";

export const runtime = "nodejs";

type TradePageProps = {
  params: Promise<{ positionId: string }>;
};

export async function generateMetadata({ params }: TradePageProps): Promise<Metadata> {
  const { positionId } = await params;
  const share = await readShare(positionId);
  const path = `/trades/${encodeURIComponent(positionId)}`;
  const image = `${path}/opengraph-image`;

  return {
    title: `${share.title} | Cassie`,
    description: share.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName,
      title: share.title,
      description: share.description,
      images: [{ url: image, width: 1200, height: 630, alt: share.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: share.title,
      description: share.description,
      images: [new URL(image, siteUrl).toString()],
    },
    robots: { index: false, follow: false },
  };
}

export default async function TradeSharePage({ params }: TradePageProps) {
  const { positionId } = await params;
  const share = await readShare(positionId);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        gap: 24,
        padding: "clamp(16px, 4vw, 64px)",
        background: "#040504",
      }}
    >
      <TradeCard {...share.cardProps} variant="band" />
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
