# Market Data API Shapes

This file records the external request and response shapes Cassie relies on for venue discovery and market-data confirmation.

## Sources

- Hyperliquid Info endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- Hyperliquid Perpetuals info endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- Hyperliquid Asset IDs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids
- Polymarket API introduction: https://docs.polymarket.com/api-reference/introduction
- Polymarket Market Data overview: https://docs.polymarket.com/market-data/overview
- Polymarket CLOB public methods: https://docs.polymarket.com/trading/clients/public

## Hyperliquid

### Perpetual Market Discovery And Context

Endpoint:

```http
POST https://api.hyperliquid.xyz/info
Content-Type: application/json
```

Request:

```json
{
  "type": "metaAndAssetCtxs"
}
```

Optional request field:

```json
{
  "type": "metaAndAssetCtxs",
  "dex": "xyz"
}
```

Response shape:

```ts
type HyperliquidMetaAndAssetCtxs = [
  {
    universe: Array<{
      name: string;
      szDecimals?: number;
      maxLeverage?: number;
      onlyIsolated?: boolean;
      marginMode?: string;
      isDelisted?: boolean;
      marginTableId?: number;
      growthMode?: string;
      lastGrowthModeChangeTime?: string;
    }>;
    marginTables?: unknown[];
    collateralToken?: number;
  },
  Array<{
    dayNtlVlm?: string;
    dayBaseVlm?: string;
    funding?: string;
    impactPxs?: [string, string] | null;
    markPx?: string;
    midPx?: string | null;
    openInterest?: string;
    oraclePx?: string;
    premium?: string | null;
    prevDayPx?: string;
  }>,
];
```

Notes:

- Perpetual `coin` names are the names returned in the `meta` response.
- `metaAndAssetCtxs` confirms that a symbol exists and provides mark price, funding, open interest, and volume context.
- It does not by itself prove an equity/pre-stock classification unless the relevant response fields or related annotation/category endpoints support that classification.

### Perpetual Metadata Only

Endpoint:

```http
POST https://api.hyperliquid.xyz/info
Content-Type: application/json
```

Request:

```json
{
  "type": "meta"
}
```

Optional request field:

```json
{
  "type": "meta",
  "dex": "xyz"
}
```

Response shape:

```ts
type HyperliquidMeta = {
  universe: Array<{
    name: string;
    szDecimals?: number;
    maxLeverage?: number;
    onlyIsolated?: boolean;
    marginMode?: string;
    isDelisted?: boolean;
    marginTableId?: number;
    growthMode?: string;
    lastGrowthModeChangeTime?: string;
  }>;
  marginTables?: unknown[];
  collateralToken?: number;
};
```

### L2 Book

Endpoint:

```http
POST https://api.hyperliquid.xyz/info
Content-Type: application/json
```

Request:

```json
{
  "type": "l2Book",
  "coin": "BTC"
}
```

Optional request fields:

```json
{
  "type": "l2Book",
  "coin": "BTC",
  "nSigFigs": 5,
  "mantissa": 1
}
```

Response shape used by Cassie:

```ts
type HyperliquidL2Book = {
  levels?: [
    Array<{ px: string; sz: string }>,
    Array<{ px: string; sz: string }>,
  ];
};
```

Notes:

- The docs state the L2 book returns at most 20 levels per side.
- Cassie should use this to confirm spread and slippage after symbol discovery.

### Perp Annotation

Endpoint:

```http
POST https://api.hyperliquid.xyz/info
Content-Type: application/json
```

Request:

```json
{
  "type": "perpAnnotation",
  "coin": "BTC"
}
```

Response shape:

```ts
type HyperliquidPerpAnnotation = unknown;
```

Cassie use:

- Use this endpoint to investigate whether a perp has official venue-provided annotation metadata.
- Do not infer `pre_stock_perp` from thesis text when annotation/category metadata is available.

### Perp Categories

Endpoint:

```http
POST https://api.hyperliquid.xyz/info
Content-Type: application/json
```

Request:

```json
{
  "type": "perpCategories"
}
```

Response shape:

```ts
type HyperliquidPerpCategories = unknown;
```

Cassie use:

- Use this endpoint to check whether Hyperliquid exposes a category taxonomy that can distinguish crypto perps, builder-deployed perps, equity-like perps, pre-launch/pre-stock perps, or other groups.
- If no category or annotation confirms the type, represent venue truth as a confirmed perp with a separate requested exposure type from the AI trade-expression step.

## Polymarket

### Market Discovery

Endpoint:

```http
GET https://gamma-api.polymarket.com/markets
```

Current Cassie request:

```http
GET /markets?limit=10&active=true&closed=false&search={query}
```

Response shape:

```ts
type PolymarketMarket = {
  id?: string;
  question?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  liquidityNum?: number;
  volumeNum?: number;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  conditionId?: string;
  endDate?: string;
  enableOrderBook?: boolean;
};

type PolymarketMarketsResponse =
  | PolymarketMarket[]
  | {
      data?: PolymarketMarket[];
      markets?: PolymarketMarket[];
    };
```

Notes:

- Polymarket market discovery belongs to the Gamma API.
- Markets map to binary outcomes, CLOB token IDs, market address, question ID, and condition ID.
- `outcomes` and `outcomePrices` map 1:1. Index 0 is usually Yes and index 1 is usually No.
- Markets can be traded through CLOB when order book support is enabled.

### CLOB Book

Endpoint:

```http
GET https://clob.polymarket.com/book
```

Request:

```http
GET /book?token_id={clobTokenId}
```

Response shape used by Cassie:

```ts
type PolymarketBook = {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
};
```

Notes:

- Use Gamma to discover markets and token IDs.
- Use CLOB to confirm live book, spread, midpoint, and tradable liquidity.

### CLOB Price, Midpoint, And Spread

Endpoints listed by Polymarket docs:

```http
GET https://clob.polymarket.com/price
GET https://clob.polymarket.com/prices
GET https://clob.polymarket.com/midpoint
GET https://clob.polymarket.com/spread
```

Cassie use:

- These can replace or supplement `GET /book` when a lightweight market-data check is enough.
- `GET /book` remains the better source for spread and slippage estimation.

## Implementation Guidance

- Use official venue responses to confirm existence, price, book, liquidity, and product metadata.
- Use AI trade-expression output to propose the intended economic exposure and venue query.
- Do not classify instrument type by scanning thesis or prompt text for words like `ipo`, `pre-ipo`, or `pre-stock`.
- If venue metadata confirms only a perp market, store that as confirmed venue truth and keep any AI-proposed exposure type as requested or interpreted exposure.
- If provider docs expose annotation/category metadata, query it before labeling a market as a specialized product type.
