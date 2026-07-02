export type CassieActivityItem = {
  id: string;
  kind: "trade" | "trade_close" | "watch" | "counter" | "deposit";
  at: string;
  title: string;
  subtitle: string;
  status: string;
  amountUsd: number | null;
  instrument: string | null;
  venue: string | null;
  side: string | null;
  source: "cassie" | "x";
  sourceUrl: string | null;
  authorHandle: string | null;
  authorName: string | null;
  sourceText: string | null;
  error: string | null;
};
