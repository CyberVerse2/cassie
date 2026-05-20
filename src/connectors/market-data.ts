import type { MarketCandidate, ResearchReport, Thesis } from "../schemas.js";
import type { MarketDataProvider } from "../tools/market.js";
import { readJsonResponse } from "./errors.js";

type HyperliquidMetaAndCtxs = [
  {
    universe: Array<{
      name: string;
    }>;
  },
  Array<{
    markPx?: string;
    midPx?: string;
    dayNtlVlm?: string;
    funding?: string;
  }>,
];

type PolymarketMarket = {
  id?: string;
  question?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  liquidityNum?: number;
  volumeNum?: number;
  outcomes?: string | string[];
};

export class CompositeMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly providers: MarketDataProvider[] = [
      new HyperliquidMarketDataProvider(),
      new PolymarketMarketDataProvider(),
    ],
  ) {}

  async findCandidates(input: {
    thesis: Thesis;
    researchReport?: ResearchReport;
  }): Promise<MarketCandidate[]> {
    const results = await Promise.allSettled(
      this.providers.map((provider) => provider.findCandidates(input)),
    );

    return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  }
}

export class HyperliquidMarketDataProvider implements MarketDataProvider {
  constructor(private readonly endpoint = "https://api.hyperliquid.xyz/info") {}

  async findCandidates(input: { thesis: Thesis }): Promise<MarketCandidate[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const [meta, ctxs] = await readJsonResponse<HyperliquidMetaAndCtxs>("Hyperliquid market data", response);

    return meta.universe.flatMap((asset, index) => {
      if (!input.thesis.mentionedAssets.includes(asset.name)) {
        return [];
      }

      const ctx = ctxs[index];
      const volume = Number(ctx?.dayNtlVlm ?? 0);

      return [
        {
          venue: "hyperliquid",
          instrument: "perp",
          side: input.thesis.direction === "bearish" ? "short" : "long",
          symbol: asset.name,
          liquidityScore: Math.min(1, volume / 50_000_000),
          spreadBps: 10,
          thesisFit: input.thesis.confidence,
          reason: `${asset.name} perp directly maps to the thesis asset.`,
        } satisfies MarketCandidate,
      ];
    });
  }
}

export class PolymarketMarketDataProvider implements MarketDataProvider {
  constructor(private readonly endpoint = "https://gamma-api.polymarket.com/markets") {}

  async findCandidates(input: { thesis: Thesis }): Promise<MarketCandidate[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("limit", "10");
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("search", input.thesis.claim);

    const response = await fetch(url);
    const markets = await readJsonResponse<PolymarketMarket[]>("Polymarket market data", response);

    return markets
      .filter((market) => market.active !== false && market.closed !== true)
      .map((market) => ({
        venue: "polymarket",
        instrument: "prediction_market",
        side: input.thesis.direction === "bearish" ? "buy_no" : "buy_yes",
        symbol: market.slug ?? market.id ?? market.question ?? "unknown",
        liquidityScore: Math.min(1, Number(market.liquidityNum ?? market.volumeNum ?? 0) / 500_000),
        spreadBps: 25,
        thesisFit: input.thesis.confidence,
        reason: market.question ?? "Prediction market related to the thesis.",
      }));
  }
}
