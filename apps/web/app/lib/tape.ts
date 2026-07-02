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
};

export type TapePayload = {
  calls: TapeCall[];
};
