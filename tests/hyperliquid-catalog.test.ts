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
});
