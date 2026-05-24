import { describe, expect, it } from "vitest";
import {
  buildHyperliquidAssetSearchText,
  searchHyperliquidCatalog,
  type HyperliquidCatalogAsset,
} from "../packages/adapters/hyperliquid/catalog.ts";

const catalog: HyperliquidCatalogAsset[] = [
  {
    venue: "hyperliquid",
    catalogId: "hyperliquid:vntl:ANTHROPIC",
    symbol: "vntl:ANTHROPIC",
    baseSymbol: "ANTHROPIC",
    displayName: "Anthropic",
    surface: "hip3_perp",
    instrumentType: "pre_stock_perp",
    dex: "vntl",
    aliases: ["Anthropic", "Claude", "ANTHROPIC"],
    searchText: "Anthropic Claude private AI company pre-stock perp vntl:ANTHROPIC",
    maxLeverage: 3,
    onlyIsolated: true,
    marginMode: "strictIsolated",
    source: "hyperliquid_metaAndAssetCtxs",
    raw: { name: "vntl:ANTHROPIC" },
    lastSeenAt: "2026-05-23T00:00:00.000Z",
  },
  {
    venue: "hyperliquid",
    catalogId: "hyperliquid:perp:BTC",
    symbol: "BTC",
    baseSymbol: "BTC",
    displayName: "BTC",
    surface: "native_perp",
    instrumentType: "perp",
    dex: null,
    aliases: ["BTC", "Bitcoin"],
    searchText: "BTC Bitcoin native perp",
    maxLeverage: 40,
    onlyIsolated: false,
    marginMode: null,
    source: "hyperliquid_metaAndAssetCtxs",
    raw: { name: "BTC" },
    lastSeenAt: "2026-05-23T00:00:00.000Z",
  },
  {
    venue: "hyperliquid",
    catalogId: "hyperliquid:perp:AI",
    symbol: "AI",
    baseSymbol: "AI",
    displayName: "AI",
    surface: "native_perp",
    instrumentType: "perp",
    dex: null,
    aliases: ["AI"],
    searchText: "AI AI AI native perp",
    maxLeverage: 3,
    onlyIsolated: false,
    marginMode: null,
    source: "hyperliquid_metaAndAssetCtxs",
    raw: { name: "AI" },
    lastSeenAt: "2026-05-23T00:00:00.000Z",
  },
  {
    venue: "hyperliquid",
    catalogId: "hyperliquid:perp:TAO",
    symbol: "TAO",
    baseSymbol: "TAO",
    displayName: "Bittensor",
    surface: "native_perp",
    instrumentType: "perp",
    dex: null,
    aliases: ["TAO", "Bittensor"],
    searchText: "TAO Bittensor native perp",
    maxLeverage: 5,
    onlyIsolated: false,
    marginMode: null,
    source: "hyperliquid_metaAndAssetCtxs",
    raw: { name: "TAO" },
    lastSeenAt: "2026-05-23T00:00:00.000Z",
  },
];

describe("Hyperliquid asset catalog", () => {
  it("finds HIP-3 private company markets by semantic aliases", () => {
    const results = searchHyperliquidCatalog(catalog, "Claude private AI company");

    expect(results[0]?.symbol).toBe("vntl:ANTHROPIC");
    expect(results[0]?.instrumentType).toBe("pre_stock_perp");
  });

  it("keeps raw symbols searchable", () => {
    const text = buildHyperliquidAssetSearchText(catalog[0]!);

    expect(text).toContain("vntl:ANTHROPIC");
    expect(text).toContain("Anthropic");
  });

  it("does not map generic AI themes to the AI ticker", () => {
    const results = searchHyperliquidCatalog(catalog, "AI inference infrastructure proxy", 5);

    expect(results.map((result) => result.symbol)).not.toContain("AI");
  });

  it("lets named project aliases drive discovery before generic themes", () => {
    const results = searchHyperliquidCatalog(catalog, "Venice Chutes Bittensor AI inference", 5);

    expect(results[0]?.symbol).toBe("TAO");
    expect(results.map((result) => result.symbol)).not.toContain("AI");
  });

  it("allows explicit symbol anchors to match generic-looking tickers", () => {
    const results = searchHyperliquidCatalog(catalog, "AI", 5, {
      exactSymbolTokens: ["AI"],
    });

    expect(results[0]?.symbol).toBe("AI");
  });
});
