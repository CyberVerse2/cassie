"use client";

import { useQuery } from "@tanstack/react-query";
import { TradeCard } from "../../components/trade-card";
import type { TradeShareData } from "../../lib/trade-card-data";

type Position = TradeShareData["position"];

export function TradeShareClient({ initialShare, frameWidth }: { initialShare: TradeShareData; frameWidth?: number }) {
  const markQuery = useQuery({
    queryKey: ["tradeShare", initialShare.position.positionId, "mark"],
    queryFn: async () => {
      const response = await fetch(`/api/trades/${encodeURIComponent(initialShare.position.positionId)}/mark`);
      const payload = await response.json() as { position?: Position; error?: string };
      if (!response.ok || !payload.position) {
        throw new Error(payload.error ?? "Trade mark could not be loaded.");
      }
      return payload.position;
    },
    refetchInterval: initialShare.position.status === "open" ? 30_000 : false,
    staleTime: 5_000,
  });
  const share = markQuery.data ? applyLivePosition(initialShare, markQuery.data) : initialShare;

  return <TradeCard {...share.cardProps} frameWidth={frameWidth} />;
}

function applyLivePosition(share: TradeShareData, position: Position): TradeShareData {
  const pnlPercent = formatSignedPct(position.unrealizedPnlPct);
  const pnlTone = position.unrealizedPnlPct < 0 ? "down" : "up";
  const exitLabel = formatPrice(position.currentMarkPrice ?? position.entryPrice, position.venue);
  return {
    ...share,
    position,
    pnlPercent,
    pnlTone,
    exitLabel,
    cardProps: {
      ...share.cardProps,
      tradeResult: share.cardProps.tradeResult
        ? {
          ...share.cardProps.tradeResult,
          percent: pnlPercent,
          exit: exitLabel,
        }
        : undefined,
    },
  };
}

function formatSignedPct(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

function formatPrice(value: number | null, venue: string): string {
  if (value == null) return "—";
  if (venue === "polymarket") return `${Math.round(value * 100)}c`;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
