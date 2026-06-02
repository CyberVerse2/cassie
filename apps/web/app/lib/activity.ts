export type CassieActivityItem = {
  id: string;
  kind: "trade" | "watch" | "counter";
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
  error: string | null;
};
