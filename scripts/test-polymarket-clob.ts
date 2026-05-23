import "dotenv/config";
import { pathToFileURL } from "node:url";
import { assertPolymarketExecutionEnv, config, readPolymarketExecutionEnv } from "../packages/core/config.ts";
import { Chain, ClobClient, OrderType, Side } from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

type PolymarketGammaResponse = PolymarketGammaMarket[] | {
  data?: PolymarketGammaMarket[];
  markets?: PolymarketGammaMarket[];
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
  if (!market) {
    throw new Error("No market selected.");
  }

  const tokenId = selectOutcomeToken(market, args.outcome);
  const publicClient = new ClobClient({
    host: clobHost(),
    chain: Chain.POLYGON,
    throwOnError: true,
  });
  const book = await publicClient.getOrderBook(tokenId);
  const bestBid = topPrice(book.bids, "bid");
  const bestAsk = topPrice(book.asks, "ask");
  const tickSize = await publicClient.getTickSize(tokenId);
  const negRisk = await publicClient.getNegRisk(tokenId);

  console.log(JSON.stringify({
    mode: args.execute ? "execute" : "dry_run",
    query: args.query,
    selectedMarket: market,
    selectedOutcome: args.outcome,
    outcomeTokenId: tokenId,
    book: {
      bestBid,
      bestAsk,
      tickSize,
      negRisk,
    },
  }, null, 2));

  if (!args.execute) {
    console.log("Dry run only. Re-run with --execute to place a FAK market BUY.");
    return;
  }

  const client = authenticatedClient();
  const response = await client.createAndPostMarketOrder(
    {
      tokenID: tokenId,
      amount: args.sizeUsd,
      side: Side.BUY,
      orderType: OrderType.FAK,
    },
    { tickSize, negRisk },
    OrderType.FAK,
  );

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
  const url = new URL(config.polymarket.gammaMarketsUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("search", query);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Polymarket search failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json() as PolymarketGammaResponse;
  const rawMarkets = Array.isArray(payload) ? payload : payload.data ?? payload.markets ?? [];
  return rawMarkets
    .filter((market) => market.active !== false && market.closed !== true)
    .map(normalizeMarket)
    .filter((market) => market.tokenIds.length > 0);
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
    outcomes: parseStringArray(market.outcomes),
    tokenIds: parseStringArray(market.clobTokenIds),
    prices: parseStringArray(market.outcomePrices).map(Number).filter(Number.isFinite),
    liquidityUsd: Number(market.liquidityNum ?? 0) || 0,
    volumeUsd: Number(market.volumeNum ?? 0) || 0,
    endDate: market.endDate ?? null,
  };
}

function authenticatedClient(): ClobClient {
  const config = assertPolymarketExecutionEnv(readPolymarketExecutionEnv());
  const account = privateKeyToAccount(config.privateKey);
  const signer = createWalletClient({
    account,
    transport: http(config.rpcUrl),
  });

  return new ClobClient({
    host: config.host,
    chain: Chain.POLYGON,
    signer,
    creds: config.creds,
    signatureType: config.signatureType,
    funderAddress: config.funderAddress,
    builderConfig: config.builderCode
      ? { builderCode: config.builderCode }
      : undefined,
    throwOnError: true,
  });
}

function clobHost(): string {
  return readPolymarketExecutionEnv().host;
}

function parseStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stringFlag(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFlag(flags: Map<string, string | true>, name: string, fallback: number): number {
  const raw = stringFlag(flags, name);
  if (!raw) return fallback;
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
  const prices = levels.map((level) => Number(level.price)).filter(Number.isFinite);
  if (prices.length === 0) return null;
  return side === "bid" ? Math.max(...prices) : Math.min(...prices);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
