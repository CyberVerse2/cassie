import "dotenv/config";
import { pathToFileURL } from "node:url";
import { assertPolymarketExecutionEnv, readPolymarketExecutionEnv } from "../packages/core/config.ts";

type PolymarketGammaMarket = {
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
};

type PolymarketSearchEvent = {
  markets?: PolymarketSdkMarket[];
};

type PolymarketSdkMarket = {
  id?: string;
  question?: string | null;
  slug?: string | null;
  conditionId?: string | null;
  state?: {
    active?: boolean;
    closed?: boolean;
    endDate?: string | null;
  } | null;
  metrics?: {
    liquidity?: string | number | null;
    liquidityNum?: string | number | null;
    volume?: string | number | null;
    volumeNum?: string | number | null;
  } | null;
  outcomes?: {
    yes?: { label?: string | null; tokenId?: string | null; price?: string | number | null } | null;
    no?: { label?: string | null; tokenId?: string | null; price?: string | number | null } | null;
  } | null;
};

export type PolymarketSmokeArgs = {
  query: string;
  outcome: "yes" | "no";
  sizeUsd: number;
  limit: number;
  marketIndex: number | null;
  marketSlug: string | null;
  conditionId: string | null;
  execute: boolean;
};

type NormalizedMarket = {
  question: string;
  slug: string;
  conditionId: string | null;
  outcomes: string[];
  tokenIds: string[];
  prices: number[];
  liquidityUsd: number;
  volumeUsd: number;
  endDate: string | null;
};

export function parsePolymarketSmokeArgs(argv: string[]): PolymarketSmokeArgs {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item?.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      index += 1;
    }
  }

  const query = stringFlag(flags, "query");
  if (!query) {
    throw new Error("Usage: npm run smoke:polymarket-clob -- --query \"Solana ETF\" [--outcome yes] [--size-usd 1] [--execute]");
  }

  const outcome = stringFlag(flags, "outcome") ?? "yes";
  if (outcome !== "yes" && outcome !== "no") {
    throw new Error("--outcome must be yes or no.");
  }

  return {
    query,
    outcome,
    sizeUsd: numberFlag(flags, "size-usd", 1),
    limit: numberFlag(flags, "limit", 10),
    marketIndex: optionalNumberFlag(flags, "market-index"),
    marketSlug: stringFlag(flags, "market-slug"),
    conditionId: stringFlag(flags, "condition-id"),
    execute: flags.get("execute") === true,
  };
}

export function selectOutcomeToken(market: NormalizedMarket, outcome: "yes" | "no"): string {
  const outcomeIndex = market.outcomes.findIndex((item) => item.toLowerCase() === outcome);
  const index = outcomeIndex >= 0 ? outcomeIndex : outcome === "yes" ? 0 : 1;
  const tokenId = market.tokenIds[index];
  if (!tokenId) {
    throw new Error(`Market ${market.slug} has no ${outcome.toUpperCase()} outcome token.`);
  }
  return tokenId;
}

async function main(): Promise<void> {
  const args = parsePolymarketSmokeArgs(process.argv.slice(2));
  const markets = await searchPolymarketMarkets(args.query, args.limit);
  if (markets.length === 0) {
    throw new Error(`No active Polymarket markets found for query: ${args.query}`);
  }

  const market = selectMarket(markets, args);
  if (!market) {
    console.log(JSON.stringify({
      mode: "candidate_list",
      query: args.query,
      message: "Choose a market with --market-index, --market-slug, or --condition-id before quoting or executing.",
      candidates: markets.map((candidate, index) => ({
        index,
        question: candidate.question,
        slug: candidate.slug,
        conditionId: candidate.conditionId,
        outcomes: candidate.outcomes,
        prices: candidate.prices,
        liquidityUsd: candidate.liquidityUsd,
        volumeUsd: candidate.volumeUsd,
        endDate: candidate.endDate,
      })),
    }, null, 2));
    return;
  }

  const tokenId = selectOutcomeToken(market, args.outcome);
  const { OrderSide } = await import("@polymarket/client");
  const publicClient = await publicPolymarketClient();
  const [book, buyPrice, spread] = await Promise.all([
    publicClient.fetchOrderBook({ tokenId }),
    publicClient.fetchPrice({ tokenId, side: OrderSide.BUY }),
    publicClient.fetchSpread({ tokenId }),
  ]);
  const bestBid = topPrice(book.bids, "bid");
  const bestAsk = topPrice(book.asks, "ask");

  console.log(JSON.stringify({
    mode: args.execute ? "execute" : "dry_run",
    query: args.query,
    selectedMarket: market,
    selectedOutcome: args.outcome,
    outcomeTokenId: tokenId,
    book: {
      bestBid,
      bestAsk,
      buyPrice,
      spread,
    },
  }, null, 2));

  if (!args.execute) {
    console.log("Dry run only. Re-run with --execute to place a FAK market BUY.");
    return;
  }

  const { OrderType } = await import("@polymarket/client");
  const client = await authenticatedClient();
  const response = await client.placeMarketOrder({
    tokenId,
    amount: args.sizeUsd,
    side: OrderSide.BUY,
    orderType: OrderType.FAK,
  });

  console.log(JSON.stringify({ executionResponse: response }, null, 2));
}

function selectMarket(markets: NormalizedMarket[], args: PolymarketSmokeArgs): NormalizedMarket | null {
  if (args.conditionId) {
    const market = markets.find((candidate) => candidate.conditionId === args.conditionId);
    if (!market) {
      throw new Error(`No market matched --condition-id ${args.conditionId}.`);
    }
    return market;
  }
  if (args.marketSlug) {
    const market = markets.find((candidate) => candidate.slug === args.marketSlug);
    if (!market) {
      throw new Error(`No market matched --market-slug ${args.marketSlug}.`);
    }
    return market;
  }
  if (args.marketIndex != null) {
    const market = markets[args.marketIndex];
    if (!market) {
      throw new Error(`No market at --market-index ${args.marketIndex}; search returned ${markets.length} markets.`);
    }
    return market;
  }
  return null;
}

async function searchPolymarketMarkets(query: string, limit: number): Promise<NormalizedMarket[]> {
  const client = await publicPolymarketClient();
  const page = await client.search({
    q: query,
    pageSize: limit,
    eventsStatus: "active",
    optimized: false,
  }).firstPage();
  const rawMarkets = (page.items.events as PolymarketSearchEvent[])
    .flatMap((event) => (event.markets ?? []).map(polymarketMarketFromSdkMarket));
  return rawMarkets
    .filter((market) => market.active !== false && market.closed !== true)
    .map(normalizeMarket)
    .filter((market) => market.tokenIds.length > 0);
}

function polymarketMarketFromSdkMarket(market: PolymarketSdkMarket): PolymarketGammaMarket {
  return {
    id: market.id,
    slug: market.slug ?? undefined,
    question: market.question ?? undefined,
    active: market.state?.active,
    closed: market.state?.closed,
    liquidityNum: Number(market.metrics?.liquidityNum ?? market.metrics?.liquidity ?? 0) || 0,
    volumeNum: Number(market.metrics?.volumeNum ?? market.metrics?.volume ?? 0) || 0,
    outcomes: JSON.stringify([
      market.outcomes?.yes?.label ?? "Yes",
      market.outcomes?.no?.label ?? "No",
    ]),
    outcomePrices: JSON.stringify([
      market.outcomes?.yes?.price ?? null,
      market.outcomes?.no?.price ?? null,
    ]),
    clobTokenIds: JSON.stringify([
      market.outcomes?.yes?.tokenId ?? null,
      market.outcomes?.no?.tokenId ?? null,
    ]),
    conditionId: market.conditionId ?? undefined,
    endDate: market.state?.endDate ?? undefined,
  };
}

function normalizeMarket(market: PolymarketGammaMarket): NormalizedMarket {
  const slug = market.slug ?? market.id ?? market.question;
  if (!slug) {
    throw new Error("Polymarket search returned a market without slug, id, or question.");
  }

  return {
    question: market.question ?? slug,
    slug,
    conditionId: market.conditionId ?? null,
    outcomes: parseStringArray(market.outcomes, "outcomes"),
    tokenIds: parseStringArray(market.clobTokenIds, "clobTokenIds"),
    prices: parsePriceArray(market.outcomePrices, "outcomePrices"),
    liquidityUsd: Number(market.liquidityNum ?? 0) || 0,
    volumeUsd: Number(market.volumeNum ?? 0) || 0,
    endDate: market.endDate ?? null,
  };
}

async function publicPolymarketClient() {
  const { createPublicClient } = await import("@polymarket/client");
  return createPublicClient();
}

async function authenticatedClient() {
  const config = assertPolymarketExecutionEnv(readPolymarketExecutionEnv());
  const [{ createSecureClient, relayerApiKey }, { privateKey }] = await Promise.all([
    import("@polymarket/client"),
    import("@polymarket/client/viem"),
  ]);

  const client = await createSecureClient({
    apiKey: config.relayerApiKey && config.relayerApiKeyAddress
      ? relayerApiKey({
        key: config.relayerApiKey,
        address: config.relayerApiKeyAddress,
      })
      : undefined,
    credentials: config.creds,
    signer: privateKey(config.privateKey),
    wallet: config.funderAddress,
  });
  if (!config.funderAddress) {
    return client;
  }
  if (!config.relayerApiKey || !config.relayerApiKeyAddress) {
    throw new Error("Polymarket gasless trading setup requires POLYMARKET_RELAYER_API_KEY and POLYMARKET_RELAYER_API_KEY_ADDRESS.");
  }
  return await client.isGaslessReady()
    ? client
    : await client.setupGaslessWallet();
}

export function parseStringArray(value: string | string[] | undefined, name: string): string[] {
  if (Array.isArray(value)) return assertStringArray(value, name);
  if (!value) return [];

  return assertStringArray(parseJsonArray(value, name).filter((item) => item != null), name);
}

function assertStringArray(value: unknown[], name: string): string[] {
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`Polymarket market ${name}[${index}] must be a string.`);
    }
    return item;
  });
}

export function parsePriceArray(value: string | string[] | undefined, name: string): number[] {
  const items = Array.isArray(value)
    ? value
    : value
      ? parseJsonArray(value, name).filter((item) => item != null)
      : [];

  return items.map((item, index) => {
    if (typeof item !== "string" && typeof item !== "number") {
      throw new Error(`Polymarket market ${name}[${index}] must be a string or number.`);
    }
    const price = Number(item);
    if (!Number.isFinite(price)) {
      throw new Error(`Polymarket market ${name}[${index}] must be numeric.`);
    }
    return price;
  });
}

function parseJsonArray(value: string, name: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Polymarket market ${name} must be a JSON array.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Polymarket market ${name} must be a JSON array.`);
  }
  return parsed;
}

function stringFlag(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFlag(flags: Map<string, string | true>, name: string, defaultValue: number): number {
  const raw = stringFlag(flags, name);
  if (!raw) return defaultValue;
  return parseNonnegativeNumber(raw, name);
}

function optionalNumberFlag(flags: Map<string, string | true>, name: string): number | null {
  const raw = stringFlag(flags, name);
  if (!raw) return null;
  return parseNonnegativeNumber(raw, name);
}

function parseNonnegativeNumber(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a nonnegative number.`);
  }
  return value;
}

function topPrice(levels: Array<{ price: string; size: string }>, side: "bid" | "ask"): number | null {
  let best: number | null = null;
  for (const level of levels) {
    const price = Number(level.price);
    if (!Number.isFinite(price)) continue;
    best = best == null
      ? price
      : side === "bid"
        ? Math.max(best, price)
        : Math.min(best, price);
  }
  return best;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
