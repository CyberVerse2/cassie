# Hyperliquid Asset Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a checked-in Hyperliquid asset catalog snapshot that includes native, HIP-3, and spot surfaces, and expose local search helpers for market discovery.

**Architecture:** A refresh script queries Hyperliquid live metadata for configured perp dexes and spot metadata, normalizes the result into a JSON catalog, and writes it to `data/markets/hyperliquid-catalog.json`. Runtime code treats the JSON as a discovery index only; live quotes and order books still come from Hyperliquid before selection, risk, or ticket creation.

**Tech Stack:** TypeScript, Node `fetch`, Zod-style typed records, Vitest, checked-in JSON artifact.

---

## File Structure

- Create `data/markets/hyperliquid-catalog.json`: committed generated catalog snapshot.
- Create `scripts/refresh-hyperliquid-catalog.ts`: reproducible script that queries Hyperliquid metadata and writes the JSON snapshot.
- Create `packages/markets/hyperliquid-catalog.ts`: local catalog loader and search helpers.
- Create `tests/hyperliquid-catalog.test.ts`: unit tests for catalog search/classification behavior using fixture records.
- Modify `package.json`: add `markets:refresh:hyperliquid` script.

## Task 1: Catalog Types And Search Helper

**Files:**
- Create: `packages/markets/hyperliquid-catalog.ts`
- Test: `tests/hyperliquid-catalog.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/hyperliquid-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildHyperliquidAssetSearchText,
  searchHyperliquidCatalog,
  type HyperliquidCatalogAsset,
} from "../packages/markets/hyperliquid-catalog.ts";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/hyperliquid-catalog.test.ts
```

Expected: fail because `packages/markets/hyperliquid-catalog.ts` does not exist.

- [ ] **Step 3: Implement catalog helper**

Create `packages/markets/hyperliquid-catalog.ts` with typed catalog records, `buildHyperliquidAssetSearchText`, and `searchHyperliquidCatalog`. The search helper may use local token overlap for this first checked-in catalog helper, but agent-facing semantic selection must still happen through AI ranking before trading.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/hyperliquid-catalog.test.ts
```

Expected: pass.

## Task 2: Refresh Script And Checked-In Snapshot

**Files:**
- Create: `scripts/refresh-hyperliquid-catalog.ts`
- Create: `data/markets/hyperliquid-catalog.json`
- Modify: `package.json`

- [ ] **Step 1: Add refresh script**

Create a script that:

- queries `{ type: "metaAndAssetCtxs" }` for native perps
- queries `{ type: "metaAndAssetCtxs", dex }` for configured HIP-3 dexes
- queries `{ type: "spotMetaAndAssetCtxs" }` for spot pairs and tokens
- normalizes each record into the catalog JSON shape
- writes sorted JSON to `data/markets/hyperliquid-catalog.json`

- [ ] **Step 2: Add package script**

Add this script to `package.json`:

```json
"markets:refresh:hyperliquid": "tsx scripts/refresh-hyperliquid-catalog.ts"
```

- [ ] **Step 3: Generate the snapshot**

Run:

```bash
npm run markets:refresh:hyperliquid
```

Expected: `data/markets/hyperliquid-catalog.json` exists and contains entries such as `vntl:ANTHROPIC` when live Hyperliquid metadata includes it.

## Task 3: Verification And Commit

**Files:**
- Verify: `data/markets/hyperliquid-catalog.json`
- Verify: `packages/markets/hyperliquid-catalog.ts`
- Verify: `scripts/refresh-hyperliquid-catalog.ts`
- Verify: `tests/hyperliquid-catalog.test.ts`
- Verify: `package.json`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/hyperliquid-catalog.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run build
```

Expected: the existing stale supervisor scenario tests may still fail typecheck until that separate work is cleaned up. Catalog files should not introduce new type errors.

- [ ] **Step 3: Commit**

Run:

```bash
git add package.json packages/markets/hyperliquid-catalog.ts scripts/refresh-hyperliquid-catalog.ts tests/hyperliquid-catalog.test.ts data/markets/hyperliquid-catalog.json docs/superpowers/plans/2026-05-23-hyperliquid-asset-catalog.md
git commit -m "Add Hyperliquid asset catalog snapshot"
```
