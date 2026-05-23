import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  HyperliquidCatalogAsset,
  HyperliquidCatalogInstrumentType,
} from "../packages/markets/hyperliquid-catalog.ts";

type HyperliquidPerpAsset = {
  name: string;
  szDecimals?: number;
  maxLeverage?: number;
  marginTableId?: number;
  onlyIsolated?: boolean;
  marginMode?: string;
};

type HyperliquidMetaAndCtxs = [
  {
    universe: HyperliquidPerpAsset[];
  },
  unknown[],
];

type HyperliquidSpotToken = {
  name: string;
  szDecimals?: number;
  weiDecimals?: number;
  index?: number;
  tokenId?: string;
  isCanonical?: boolean;
  evmContract?: unknown;
};

type HyperliquidSpotPair = {
  name: string;
  tokens?: number[];
  index?: number;
  isCanonical?: boolean;
};

type HyperliquidSpotMetaAndCtxs = [
  {
    tokens?: HyperliquidSpotToken[];
    universe?: HyperliquidSpotPair[];
  },
  unknown[],
];

const outputPath = "data/markets/hyperliquid-catalog.json";
const hip3Dexes = ["vntl", "xyz", "flx", "hyna", "km", "cash", "para"];
const preStockDexes = new Set(["vntl"]);
const knownAliases: Record<string, string[]> = {
  ANTHROPIC: ["Anthropic", "Claude", "AI company", "private AI company"],
  OPENAI: ["OpenAI", "ChatGPT", "AI company", "private AI company"],
  SPACEX: ["SpaceX", "Starlink", "private space company"],
  BTC: ["Bitcoin"],
  ETH: ["Ethereum"],
  SOL: ["Solana"],
  MSTR: ["MicroStrategy", "Strategy", "Michael Saylor"],
};

async function main() {
  const lastSeenAt = new Date().toISOString();
  const [nativePerps, hip3Perps, spots] = await Promise.all([
    fetchPerpCatalog(null, lastSeenAt),
    Promise.all(hip3Dexes.map((dex) => fetchPerpCatalog(dex, lastSeenAt).catch(() => []))),
    fetchSpotCatalog(lastSeenAt),
  ]);

  const catalog = uniqueByCatalogId([
    ...nativePerps,
    ...hip3Perps.flat(),
    ...spots,
  ]).sort((left, right) => left.catalogId.localeCompare(right.catalogId));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    count: catalog.length,
    hip3Dexes,
    containsAnthropic: catalog.some((asset) => asset.symbol === "vntl:ANTHROPIC"),
  }, null, 2));
}

async function fetchPerpCatalog(
  dex: string | null,
  lastSeenAt: string,
): Promise<HyperliquidCatalogAsset[]> {
  const [meta] = await postInfo<HyperliquidMetaAndCtxs>({
    type: "metaAndAssetCtxs",
    ...(dex ? { dex } : {}),
  });
  const surface = dex ? "hip3_perp" as const : "native_perp" as const;

  return meta.universe.map((asset): HyperliquidCatalogAsset => {
    const baseSymbol = baseSymbolFromHyperliquidName(asset.name);
    const instrumentType = classifyPerpInstrument(asset.name, dex);
    const aliases = aliasesFor(baseSymbol, instrumentType);

    return {
      venue: "hyperliquid",
      catalogId: `hyperliquid:${dex ?? "perp"}:${baseSymbol}`,
      symbol: asset.name,
      baseSymbol,
      displayName: displayNameFor(baseSymbol),
      surface,
      instrumentType,
      dex,
      aliases,
      searchText: [
        asset.name,
        baseSymbol,
        displayNameFor(baseSymbol),
        surface,
        instrumentType,
        dex,
        ...aliases,
      ].filter(Boolean).join(" "),
      maxLeverage: asset.maxLeverage ?? null,
      onlyIsolated: asset.onlyIsolated ?? false,
      marginMode: asset.marginMode ?? null,
      source: "hyperliquid_metaAndAssetCtxs",
      raw: asset,
      lastSeenAt,
    };
  });
}

async function fetchSpotCatalog(lastSeenAt: string): Promise<HyperliquidCatalogAsset[]> {
  const [meta] = await postInfo<HyperliquidSpotMetaAndCtxs>({
    type: "spotMetaAndAssetCtxs",
  });

  return (meta.universe ?? []).map((pair): HyperliquidCatalogAsset => {
    const baseSymbol = baseSymbolFromHyperliquidName(pair.name);
    const aliases = aliasesFor(baseSymbol, "spot");

    return {
      venue: "hyperliquid",
      catalogId: `hyperliquid:spot:${pair.name}`,
      symbol: pair.name,
      baseSymbol,
      displayName: displayNameFor(baseSymbol),
      surface: "spot",
      instrumentType: "spot",
      dex: null,
      aliases,
      searchText: [
        pair.name,
        baseSymbol,
        displayNameFor(baseSymbol),
        "spot",
        ...aliases,
      ].filter(Boolean).join(" "),
      maxLeverage: null,
      onlyIsolated: false,
      marginMode: null,
      source: "hyperliquid_spotMetaAndAssetCtxs",
      raw: pair,
      lastSeenAt,
    };
  });
}

async function postInfo<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid info request failed (${response.status}): ${await response.text()}`);
  }

  return await response.json() as T;
}

function classifyPerpInstrument(
  symbol: string,
  dex: string | null,
): HyperliquidCatalogInstrumentType {
  const baseSymbol = baseSymbolFromHyperliquidName(symbol);
  if (dex && preStockDexes.has(dex)) return "pre_stock_perp";
  if (["MAG7", "SEMIS", "ROBOT", "INFOTECH", "NUCLEAR", "TOTAL2", "OTHERS", "BTCD"].includes(baseSymbol)) {
    return "index_perp";
  }
  if (dex) return "synthetic_perp";
  return "perp";
}

function aliasesFor(
  baseSymbol: string,
  instrumentType: HyperliquidCatalogInstrumentType,
): string[] {
  const aliases = new Set<string>([
    baseSymbol,
    ...(knownAliases[baseSymbol] ?? []),
  ]);
  if (instrumentType === "pre_stock_perp") {
    aliases.add("pre-stock");
    aliases.add("pre IPO");
    aliases.add("private company");
  }
  return Array.from(aliases);
}

function displayNameFor(baseSymbol: string): string {
  const firstAlias = knownAliases[baseSymbol]?.[0];
  return firstAlias ?? baseSymbol;
}

function baseSymbolFromHyperliquidName(name: string): string {
  return name.split(":").at(-1)?.split("/")[0] ?? name;
}

function uniqueByCatalogId(catalog: HyperliquidCatalogAsset[]): HyperliquidCatalogAsset[] {
  const seen = new Set<string>();
  return catalog.filter((asset) => {
    if (seen.has(asset.catalogId)) return false;
    seen.add(asset.catalogId);
    return true;
  });
}

await main();
