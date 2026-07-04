export type TapeCall = {
  id: string;
  at: string;
  kind: "trade" | "watch" | "counter";
  sourceUrl: string;
  authorHandle: string | null;
  authorName: string | null;
  sourceText: string;
  mediaUrls: string[];
  traderHandle: string | null;
  prompt: string;
  venue: string | null;
  positionId: string | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  closed: boolean;
  // Arc trade-registry receipt (close tx preferred over open); null for
  // watches and legacy positions.
  arcTxHash: string | null;
};

export const ARC_EXPLORER_TX_URL = "https://testnet.arcscan.app/tx/";

export type TapePayload = {
  calls: TapeCall[];
};
