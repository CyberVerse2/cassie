import {
  CassieStructuredClient,
  type StructuredAiClient,
} from "../ai/client.ts";
import { CompositeMarketDataProvider } from "../adapters/index.ts";
import {
  PolymarketMarketDataProvider,
} from "../adapters/index.ts";
import {
  AiPolymarketDiscoveryQueryPlanner,
  AiPolymarketSearchResultSelector,
  type MarketDataProvider,
  type PolymarketMarketFinder,
} from "../adapters/selection.ts";
import { DrizzleCassieStore } from "../core/db/drizzle-store.ts";
import type { CassieStore } from "../core/db/store.ts";
import { formatErrorForLog } from "../core/helpers/error-format.ts";
import { GrokXSourceResolver, type SourceResolver } from "./source.ts";
import { configureAiSdkWarningLogging } from "../ai/helpers/sdk-warnings.ts";
import { runFastTicketSupervisor } from "./fast-ticket.ts";

configureAiSdkWarningLogging();

export interface CassieDependencies {
  ai?: StructuredAiClient;
  cheapAi?: StructuredAiClient;
  importantAi?: StructuredAiClient;
  marketData: MarketDataProvider;
  polymarketMarketFinder?: PolymarketMarketFinder;
  sourceResolver?: SourceResolver;
}

export async function runCassieSupervisorForRun(input: {
  runId: string;
  store?: CassieStore;
  deps?: CassieDependencies;
}) {
  const store = input.store ?? new DrizzleCassieStore();
  const run = await store.getRun(input.runId);
  if (!run) throw new Error(`Run ${input.runId} was not found.`);

  const userSettings = await store.getUserSettings(run.userId);
  if (!userSettings) throw new Error(`No Cassie settings found for user ${run.userId}.`);

  const running = {
    ...run,
    status: "running" as const,
    error: null,
    updatedAt: new Date().toISOString(),
  };
  await store.updateRun(running);

  try {
    const deps = input.deps ?? defaultDependencies();
    return await runFastTicketSupervisor({
      run: running,
      store,
      userSettings,
      deps,
    });
  } catch (error) {
    const latest = await store.getRun(running.runId);
    await store.updateRun({
      ...(latest ?? running),
      status: "failed",
      error: formatErrorForLog(error),
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function defaultDependencies(): CassieDependencies {
  const ai = new CassieStructuredClient();
  return {
    ai,
    cheapAi: ai,
    importantAi: ai,
    marketData: new CompositeMarketDataProvider(),
    sourceResolver: new GrokXSourceResolver(),
    polymarketMarketFinder: new PolymarketMarketDataProvider(
      undefined,
      new AiPolymarketDiscoveryQueryPlanner(ai),
      new AiPolymarketSearchResultSelector(ai),
    ),
  };
}

export function buildSupervisorInstructions(): string {
  return [
    "You are Cassie's governed supervisor for tagged-tweet trade research.",
    "",
    "Required fast-path architecture:",
    "preflight user policy -> one AI fast ticket plan for source mode, opportunity frame, expression generation, and exit plan -> search real venues -> assess top expression fit -> quote validated candidate -> deterministic market selection -> create trade ticket when intent allows -> finalize run.",
    "",
    "Role:",
    "Coordinate typed stages through the governed sequence. Do not replace AI-backed semantic judgments with keyword scoring, hardcoded routing, or ad hoc shortcuts.",
    "",
    "Progressive workflow:",
    "1. Establish whether the user is allowed to receive a trade workflow.",
    "2. Produce source mode, opportunity frame, abstract candidateExpressions, and exit plan in one structured AI call.",
    "3. Search only configured venues for expressions that need discovery.",
    "4. Assess the top real candidates semantically before quote.",
    "5. Quote the selected validated candidate before ticket creation.",
    "6. Finalize with the evidence-supported outcome.",
    "",
    "Stage gates:",
    "- Run preflight before semantic opportunity analysis.",
    "- Do not search venues until the fast ticket plan has produced candidateExpressions that need configured venue discovery.",
    "- Do not quote a venue candidate until expression-fit assessment validates it or identifies exactly what information is still required.",
    "- If a required stage cannot produce evidence, finalize with the explicit missing evidence or venue failure; do not silently substitute a different rail.",
    "",
    "When uncertain:",
    "- Surface missing source evidence, venue failures, rule gaps, quote gaps, or fit uncertainty in the final result.",
    "- Do not silently reroute to a different rail because a required market, quote, or rule is unavailable.",
    "",
    "Classify breaking_news from source content only. Do not use urgency words in the user command to set source mode. Use the user command only to preserve userIntent: trade, watch, countertrade, or critic.",
    "",
    "Breaking news is a routing mode, not an execution decision. In breaking-news mode, identify the headline thesis, generate direct and downstream expressions, search configured venues quickly, and route only validated expressions. For watch, countertrade, and critic intents, do not create a trade ticket; finalize with the appropriate analysis unless the preserved userIntent is trade.",
    "",
    "Do not route directly to Polymarket, crypto, or pre-IPO before framing the opportunity. First identify the market opportunity, then let candidate expression generation decide which expression rails deserve venue search.",
    "",
    "Use the AI-backed semantic tools for opportunity framing, trade-expression generation, expression-fit assessment, and expression ranking. Do not replace those judgments with keyword scoring, regex matching, hardcoded lookup tables, or term-overlap heuristics.",
    "",
    "Never invent tickers, markets, prices, liquidity, probabilities, listings, or contract rules. Venue tools may only return real configured venue candidates. If no real market validates the thesis, finalize no-trade, watchlist, or analysis-only.",
    "",
    "After selecting a real validated candidate for trade intent, create_trade_ticket creates the ticket with the user's configured default trade size and an explicit exitPlan chosen by the agent. The exitPlan must include takeProfitPct, stopLossPct, maxHoldDays, daily review cadence, thesis, and concrete invalidationSignals. The execution worker handles order submission after ticket creation.",
    "",
    "Before finalizing, verify internally that the run has the staged evidence required for its outcome: preflight decision, source mode, opportunity frame, expression plan, venue search or no-search reason, fit assessment, quote when selecting a market, market selection when selecting a market, and ticket only when preserved userIntent allows trading.",
    "",
    "Finalize every run with finalize_run after enough staged evidence exists for trade_ticket, no_trade, watchlist-style analysis, or analysis-only.",
  ].join("\n");
}
