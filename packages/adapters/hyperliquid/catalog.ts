import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type HyperliquidCatalogSurface = "native_perp" | "hip3_perp" | "spot";

export type HyperliquidCatalogInstrumentType =
  | "perp"
  | "pre_stock_perp"
  | "synthetic_perp"
  | "index_perp"
  | "spot";

export type HyperliquidCatalogAsset = {
  venue: "hyperliquid";
  catalogId: string;
  symbol: string;
  baseSymbol: string;
  displayName: string;
  surface: HyperliquidCatalogSurface;
  instrumentType: HyperliquidCatalogInstrumentType;
  dex: string | null;
  aliases: string[];
  searchText: string;
  maxLeverage: number | null;
  onlyIsolated: boolean;
  marginMode: string | null;
  source: "hyperliquid_metaAndAssetCtxs" | "hyperliquid_spotMetaAndAssetCtxs";
  raw: unknown;
  lastSeenAt: string;
};

export type HyperliquidCatalogSearchOptions = {
  exactSymbolTokens?: string[];
};

export const HYPERLIQUID_CATALOG_PATH = fileURLToPath(
  new URL("../../../data/markets/hyperliquid-catalog.json", import.meta.url),
);

const GENERIC_THEME_TOKENS = new Set([
  "ai",
  "agent",
  "agents",
  "adoption",
  "compute",
  "computing",
  "growth",
  "infra",
  "inference",
  "infrastructure",
  "market",
  "markets",
  "company",
  "crypto",
  "decentralized",
  "perp",
  "perpetual",
  "pre",
  "prediction",
  "private",
  "proxy",
  "related",
  "sector",
  "stock",
  "theme",
  "thematic",
  "token",
  "tokens",
  "unknown",
]);

export async function loadHyperliquidCatalog(
  path = HYPERLIQUID_CATALOG_PATH,
): Promise<HyperliquidCatalogAsset[]> {
  return JSON.parse(await readFile(path, "utf8")) as HyperliquidCatalogAsset[];
}

export function searchHyperliquidCatalog(
  catalog: HyperliquidCatalogAsset[],
  query: string,
  limit = 20,
  options: HyperliquidCatalogSearchOptions = {},
): HyperliquidCatalogAsset[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const exactSymbolTokens = new Set((options.exactSymbolTokens ?? []).map(normalizeToken).filter(Boolean));

  return catalog
    .map((asset) => ({
      asset,
      score: scoreCatalogAsset(asset, queryTokens, exactSymbolTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.asset.symbol.localeCompare(right.asset.symbol)
    )
    .slice(0, limit)
    .map((entry) => entry.asset);
}

export function buildHyperliquidAssetSearchText(asset: HyperliquidCatalogAsset): string {
  return [
    asset.symbol,
    asset.baseSymbol,
    asset.displayName,
    asset.surface,
    asset.instrumentType,
    asset.dex,
    ...asset.aliases,
    asset.searchText,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function scoreCatalogAsset(
  asset: HyperliquidCatalogAsset,
  queryTokens: string[],
  exactSymbolTokens: Set<string>,
): number {
  const searchText = buildHyperliquidAssetSearchText(asset).toLowerCase();
  const symbol = asset.symbol.toLowerCase();
  const baseSymbol = asset.baseSymbol.toLowerCase();
  const displayName = asset.displayName.toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    const isGenericThemeToken = GENERIC_THEME_TOKENS.has(token);
    if (baseSymbol === token || symbol === token) {
      if (!isGenericThemeToken || exactSymbolTokens.has(token)) {
        score += 12;
      }
    } else if (displayName === token) {
      score += 10;
    } else if (asset.aliases.some((alias) => alias.toLowerCase() === token)) {
      score += 8;
    } else if (!isGenericThemeToken && searchText.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  );
}

function normalizeToken(value: string): string {
  return value.toLowerCase().trim();
}
