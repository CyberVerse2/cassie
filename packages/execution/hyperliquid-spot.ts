import { readJsonResponse } from "../core/helpers/connector-errors.ts";

// Hyperliquid's allMids response keys perps by coin name ("SOL") but spot
// pairs by market name ("@142", or "PURR/USDC" for the genesis pair) — never
// by "BASE/QUOTE". Anything pricing a spot symbol must resolve the pair
// through spot metadata first; this module is the one place that does it.

export const HYPERLIQUID_INFO_ENDPOINT = "https://api.hyperliquid.xyz/info";

type HyperliquidSpotToken = {
  name: string;
  index: number;
  szDecimals: number;
  fullName?: string | null;
};

type HyperliquidSpotMarket = {
  name: string;
  index: number;
  tokens: number[];
};

type HyperliquidSpotCtx = {
  midPx?: string | null;
  markPx?: string | null;
};

export function isHyperliquidSpotSymbol(symbol: string): boolean {
  return symbol.includes("/");
}

// Resolves a spot symbol ("UZEC/USDC", "UZEC", "@142"…) to its live mid
// price via spot metadata + asset contexts.
export async function fetchHyperliquidSpotMid(
  symbol: string,
  endpoint = HYPERLIQUID_INFO_ENDPOINT,
): Promise<number> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
  });
  const [meta, ctxs] = await readJsonResponse<
    [
      { tokens: HyperliquidSpotToken[]; universe: HyperliquidSpotMarket[] },
      HyperliquidSpotCtx[],
    ]
  >("Hyperliquid spot metadata", response);

  const tokensByIndex = new Map(
    meta.tokens.map((token) => [token.index, token]),
  );
  const normalizedSymbol = normalizeHyperliquidExecutionSymbol(symbol);
  const match = meta.universe
    .map((market) => {
      const baseToken = tokensByIndex.get(market.tokens[0]!);
      const quoteToken = tokensByIndex.get(market.tokens[1]!);
      return baseToken && quoteToken ? { market, baseToken, quoteToken } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    )
    .filter(({ market, baseToken, quoteToken }) =>
      hyperliquidExecutionSymbolVariants(
        market.name,
        baseToken.name,
        quoteToken.name,
        baseToken.fullName ?? null,
      ).has(normalizedSymbol),
    )
    .sort(
      (left, right) =>
        Number(right.quoteToken.name === "USDC") -
        Number(left.quoteToken.name === "USDC"),
    )[0];

  if (!match) {
    throw new Error(
      `Hyperliquid spot asset ${symbol} was not found in live spot metadata.`,
    );
  }

  const ctx = ctxs[match.market.index];
  const mid = Number(ctx?.midPx ?? ctx?.markPx);
  if (!Number.isFinite(mid) || mid <= 0) {
    throw new Error(
      `Hyperliquid spot mid for ${symbol} (${match.market.name}) returned no usable price.`,
    );
  }
  return mid;
}

export function hyperliquidExecutionSymbolVariants(
  marketName: string,
  baseName: string,
  quoteName: string,
  baseFullName: string | null,
): Set<string> {
  const values = [
    marketName,
    baseName,
    `${baseName}/${quoteName}`,
    `${baseName}-${quoteName}`,
    baseFullName ?? "",
  ];
  const variants = values.flatMap((value) => {
    const normalized = normalizeHyperliquidExecutionSymbol(value);
    if (!normalized) return [];
    return normalized.endsWith("0")
      ? [normalized, normalized.slice(0, -1)]
      : [normalized];
  });
  return new Set(variants);
}

export function normalizeHyperliquidExecutionSymbol(value: string): string {
  return value
    .trim()
    .replace(/^\$/u, "")
    .replace(/[^a-z0-9]/giu, "")
    .toLowerCase();
}
