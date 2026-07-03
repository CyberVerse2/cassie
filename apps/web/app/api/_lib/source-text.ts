// Stored tweet text arrives HTML-ish from some webhook payloads: literal
// <br> tags, escaped entities, t.co links, and raw chain:address dumps.
// Normalize it to plain prose before it reaches a card.
export function cleanSourceText(value: string): string {
  return (
    value
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/?[a-z][^>]*>/giu, " ")
      .replace(/&amp;/giu, "&")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&quot;/giu, '"')
      .replace(/&(?:#0?39|apos);/giu, "'")
      .replace(/&nbsp;/giu, " ")
      .replace(/https?:\/\/\S+/gu, "")
      // e.g. "solana:KMNo3nJsBXfcpJTVhZcXLW7…" — contract addresses read as
      // noise and blow out card layout.
      .replace(/\b[a-z]+:[A-Za-z0-9]{16,}\b/gu, "")
      .replace(/[^\S\n]+/gu, " ")
      .trim()
  );
}
