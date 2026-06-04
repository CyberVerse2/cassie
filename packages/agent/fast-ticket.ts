import { z } from "zod";
import type { StructuredAiClient } from "../ai/client.ts";
import { withThinkingTraceCapture } from "../ai/client.ts";
import { config } from "../core/config.ts";
import type { CassieStore } from "../core/db/store.ts";
import {
  MarketCandidateSchema,
  MarketSelectionSchema,
  PolymarketQuoteSchema,
  TradeExpressionPlanSchema,
  type ControlRun,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type MarketSelection,
  type OpportunityFrame,
  type PolymarketQuote,
  type SourceModeClassification,
  type TradeExitPlan,
  type TradeExpressionPlan,
  type UserSettings,
} from "../core/schemas/index.ts";
import { createTradeTicket, MIN_HYPERLIQUID_PERP_MARGIN_USD } from "../tickets/index.ts";
import { formatTicketCreated, notifyTradeLifecycle } from "../notifications/positions.ts";
import { fastTicketPlanPromptSpec, FastTicketPlanSchema, structuredPromptInput } from "../prompts/index.ts";
import type { CassieDependencies } from "./agent.ts";
import { recordRunStep } from "./steps.ts";
import { searchVenues, assessExpressionFit, quoteExpression } from "./venues.ts";
import { thesisForMarketSelection, thesisFromTradeExpression } from "./thesis.ts";
import { finalizeResult } from "./finalization.ts";

const promptVersion = "2026-05-31";
const maxFastFitAssessments = 3;

type FastTicketPlan = z.infer<typeof FastTicketPlanSchema>;

export async function runFastTicketSupervisor(input: {
  run: ControlRun;
  store: CassieStore;
  userSettings: UserSettings;
  deps: CassieDependencies;
}) {
  const ai = input.deps.importantAi ?? input.deps.ai;
  if (!ai) {
    throw new Error("Cassie fast ticket path requires an important AI client.");
  }

  await recordPreflight(input);
  const plan = await recordFastTicketPlan({ ...input, ai });
  await recordSourceMode(input.store, input.run.runId, plan.sourceMode);
  await recordTradeExpression(input.store, input.run.runId, plan.tradeExpression);

  if (plan.sourceMode.userIntent !== "trade" || plan.opportunityFrame.userIntent !== "trade") {
    return finalizeAnalysis({
      store: input.store,
      run: input.run,
      publicSummary: plan.publicSummary,
      tradeExpression: plan.tradeExpression,
    });
  }

  if (plan.tradeExpression.decision === "no_trade" && !hasSearchableExpression(plan.tradeExpression)) {
    return finalizeAnalysis({
      store: input.store,
      run: input.run,
      publicSummary: plan.publicSummary,
      tradeExpression: plan.tradeExpression,
    });
  }

  const candidates = await recordMarketCandidates(input, plan.tradeExpression);
  if (candidates.length === 0) {
    const selection = await recordMarketSelection(input.store, input.run.runId, noSelection("No configured venue candidates matched the trade expression."));
    return finalizeAnalysis({
      store: input.store,
      run: input.run,
      publicSummary: plan.publicSummary,
      tradeExpression: plan.tradeExpression,
      marketSelection: selection,
    });
  }

  const assessed = await assessTopCandidates({
    ...input,
    ai,
    opportunityFrame: plan.opportunityFrame,
    tradeExpression: plan.tradeExpression,
    candidates,
  });
  const bestFit = bestValidatedFit(assessed);
  if (!bestFit) {
    const selection = await recordMarketSelection(
      input.store,
      input.run.runId,
      noSelection("No venue candidate passed semantic and contract-fit assessment.", assessed),
    );
    return finalizeAnalysis({
      store: input.store,
      run: input.run,
      publicSummary: plan.publicSummary,
      tradeExpression: plan.tradeExpression,
      marketSelection: selection,
    });
  }

  const selectedCandidate = candidateForFitAssessment(candidates, bestFit);
  const quote = await recordMarketQuote({
    ...input,
    candidate: selectedCandidate,
    fitAssessment: bestFit,
  });
  const marketSelection = await recordMarketSelection(
    input.store,
    input.run.runId,
    marketSelectionFromBestFit({
      selectedCandidate,
      selectedFitAssessment: bestFit,
      candidates,
      fitAssessments: assessed,
      quote,
    }),
  );
  const ticket = await recordTicket({
    ...input,
    tradeExpression: plan.tradeExpression,
    marketSelection,
    exitPlan: plan.exitPlan,
  });

  return recordFinal(input.store, input.run, {
    responseType: "trade_ticket",
    publicSummary: plan.publicSummary,
    tradeTicket: { ticketId: ticket.ticketId },
    marketSelection,
    tradeExpression: plan.tradeExpression,
  });
}

async function recordPreflight(input: {
  store: CassieStore;
  run: ControlRun;
  userSettings: UserSettings;
}) {
  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "preflight",
    stepInput: { userId: input.userSettings.userId },
    execute: async () => ({
      status: "ok" as const,
      warnings: input.userSettings.walletAddress ? [] : ["No wallet address is configured; order submission needs wallet setup."],
      policy: {
        defaultTradeSizeUsd: input.userSettings.defaultTradeSizeUsd,
        minHyperliquidPerpMarginUsd: MIN_HYPERLIQUID_PERP_MARGIN_USD,
        effectiveHyperliquidPerpMarginUsd: Math.max(input.userSettings.defaultTradeSizeUsd, MIN_HYPERLIQUID_PERP_MARGIN_USD),
        hasWalletAddress: Boolean(input.userSettings.walletAddress),
      },
    }),
  });
}

async function recordFastTicketPlan(input: {
  store: CassieStore;
  run: ControlRun;
  ai: StructuredAiClient;
}): Promise<FastTicketPlan> {
  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "opportunity",
    promptName: "cassie_fast_ticket_plan",
    promptVersion,
    model: config.ai.importantModel,
    stepInput: {
      userCommand: input.run.userCommand,
      sourcePost: input.run.sourcePost,
    },
    execute: ({ setThinkingTrace }) => input.ai.generateObject({
      ...structuredPromptInput(fastTicketPlanPromptSpec({
        sourcePost: input.run.sourcePost,
        userCommand: input.run.userCommand,
      })),
      onThinkingTrace: setThinkingTrace,
    }),
  });
}

async function recordSourceMode(store: CassieStore, runId: string, output: SourceModeClassification) {
  await store.addRunStep({
    runId,
    stepType: "intake",
    status: "succeeded",
    input: { kind: "source_mode" },
    output,
    error: null,
    model: config.ai.importantModel,
    promptName: "cassie_fast_ticket_plan",
    promptVersion,
    thinkingTrace: null,
    completedAt: new Date().toISOString(),
  });
}

async function recordTradeExpression(store: CassieStore, runId: string, output: TradeExpressionPlan) {
  await store.addRunStep({
    runId,
    stepType: "trade_expression",
    status: "succeeded",
    input: { kind: "fast_ticket_plan" },
    output: TradeExpressionPlanSchema.parse(output),
    error: null,
    model: config.ai.importantModel,
    promptName: "cassie_fast_ticket_plan",
    promptVersion,
    thinkingTrace: null,
    completedAt: new Date().toISOString(),
  });
}

async function recordMarketCandidates(input: {
  store: CassieStore;
  run: ControlRun;
  deps: CassieDependencies;
}, tradeExpression: TradeExpressionPlan) {
  const thesis = thesisFromTradeExpression(tradeExpression);
  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "market_candidates",
    stepInput: { venues: undefined, limit: undefined },
    execute: () => searchVenues({
      marketData: input.deps.marketData,
      polymarket: input.deps.polymarketMarketFinder,
      thesis,
      tradeExpression,
    }),
  });
}

async function assessTopCandidates(input: {
  store: CassieStore;
  run: ControlRun;
  ai: StructuredAiClient;
  opportunityFrame: OpportunityFrame;
  tradeExpression: TradeExpressionPlan;
  candidates: MarketCandidate[];
}): Promise<ExpressionFitAssessment[]> {
  const assessments: ExpressionFitAssessment[] = [];
  for (const candidate of input.candidates.slice(0, maxFastFitAssessments)) {
    const assessment = await recordRunStep({
      store: input.store,
      runId: input.run.runId,
      stepType: "market_assessment",
      promptName: "cassie_expression_fit",
      promptVersion,
      model: config.ai.importantModel,
      stepInput: { candidate, side: predictionMarketSideForCandidate(candidate) },
      execute: ({ setThinkingTrace }) => assessExpressionFit({
        ai: withThinkingTraceCapture(input.ai, setThinkingTrace),
        opportunityFrame: input.opportunityFrame,
        tradeExpression: input.tradeExpression,
        candidate,
        side: predictionMarketSideForCandidate(candidate),
      }),
    });
    assessments.push(assessment);
    if (assessment.fitStatus === "validated") break;
  }
  return assessments;
}

async function recordMarketQuote(input: {
  store: CassieStore;
  run: ControlRun;
  deps: CassieDependencies;
  candidate: MarketCandidate;
  fitAssessment: ExpressionFitAssessment;
}) {
  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "market_quote",
    stepInput: {
      candidate: input.candidate,
      fitAssessment: input.fitAssessment,
      side: predictionMarketSideForCandidate(input.candidate),
    },
    execute: () => quoteExpression({
      polymarket: input.deps.polymarketMarketFinder,
      candidate: input.candidate,
      side: predictionMarketSideForCandidate(input.candidate),
    }),
  });
}

async function recordMarketSelection(store: CassieStore, runId: string, selection: MarketSelection) {
  return recordRunStep({
    store,
    runId,
    stepType: "market_selection",
    stepInput: selection.selectedMarket
      ? { selectedCandidateId: selection.selectedCandidateId }
      : { noTradeReason: selection.noTradeReason },
    execute: async () => MarketSelectionSchema.parse(selection),
  });
}

async function recordTicket(input: {
  store: CassieStore;
  run: ControlRun;
  userSettings: UserSettings;
  tradeExpression: TradeExpressionPlan;
  marketSelection: MarketSelection;
  exitPlan: TradeExitPlan;
}) {
  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "ticket",
    stepInput: {
      tradeExpression: input.tradeExpression,
      marketSelection: input.marketSelection,
    },
    execute: async () => {
      const thesis = thesisForMarketSelection(input.tradeExpression, input.marketSelection);
      const ticket = createTradeTicket({
        runId: input.run.runId,
        userSettings: input.userSettings,
        thesis,
        marketSelection: input.marketSelection,
        exitPlan: input.exitPlan,
      });
      await input.store.addTradeTicket(ticket);
      await notifyTradeLifecycle({
        store: input.store,
        settings: input.userSettings,
        text: formatTicketCreated(ticket),
        entityId: ticket.ticketId,
        eventType: "telegram.ticket_created_failed",
      });
      return ticket;
    },
  });
}

function finalizeAnalysis(input: {
  store: CassieStore;
  run: ControlRun;
  publicSummary: string;
  tradeExpression: TradeExpressionPlan;
  marketSelection?: MarketSelection;
}) {
  return recordFinal(input.store, input.run, {
    responseType: "analysis",
    publicSummary: input.publicSummary,
    tradeExpression: input.tradeExpression,
    marketSelection: input.marketSelection,
  });
}

async function recordFinal(
  store: CassieStore,
  run: ControlRun,
  finalInput: {
    responseType: "analysis" | "trade_ticket";
    publicSummary: string;
    tradeTicket?: { ticketId: string };
    marketSelection?: MarketSelection;
    tradeExpression?: TradeExpressionPlan;
  },
) {
  return recordRunStep({
    store,
    runId: run.runId,
    stepType: "final",
    stepInput: finalInput,
    execute: async () => {
      const result = finalizeResult(finalInput);
      await store.updateRun({
        ...run,
        status: "succeeded",
        result,
        error: null,
        updatedAt: new Date().toISOString(),
      });
      return result;
    },
  });
}

function hasSearchableExpression(tradeExpression: TradeExpressionPlan): boolean {
  return tradeExpression.candidateExpressions.some((candidate) =>
    candidate.expressionRail !== "no_trade"
      && candidate.intendedSide !== "avoid"
      && candidate.searchTerms.length > 0
      && candidate.requiredMarketFeatures.length > 0,
  );
}

function bestValidatedFit(assessments: ExpressionFitAssessment[]) {
  return assessments
    .filter((assessment) => assessment.fitStatus === "validated")
    .sort((left, right) => right.fitScore - left.fitScore)[0] ?? null;
}

function candidateForFitAssessment(candidates: MarketCandidate[], fitAssessment: ExpressionFitAssessment): MarketCandidate {
  const match = candidates.find((candidate) =>
    candidateAssessmentKeys(candidate).some((key) => normalizedCandidateId(key) === normalizedCandidateId(fitAssessment.candidateId))
  );
  if (!match) {
    throw new Error(`Validated candidate ${fitAssessment.candidateId} was not found in venue-search results.`);
  }
  return match;
}

function marketSelectionFromBestFit(input: {
  selectedCandidate: MarketCandidate;
  selectedFitAssessment: ExpressionFitAssessment;
  candidates: MarketCandidate[];
  fitAssessments: ExpressionFitAssessment[];
  quote: MarketCandidate | PolymarketQuote;
}): MarketSelection {
  if (!quoteMatchesCandidate(input.quote, input.selectedCandidate)) {
    throw new Error("Fast ticket market selection requires a quote for the selected candidate.");
  }

  return MarketSelectionSchema.parse({
    decision: "select_market",
    selectedMarket: input.selectedCandidate,
    selectedCandidateId: input.selectedFitAssessment.candidateId,
    rejectionReason: null,
    rankedCandidates: input.fitAssessments
      .filter((assessment) => assessment.fitStatus === "validated")
      .sort((left, right) => right.fitScore - left.fitScore)
      .map((assessment) => {
        const candidate = candidateForFitAssessment(input.candidates, assessment);
        return {
          candidateId: assessment.candidateId,
          thesisFit: assessment.fitScore,
          liquidityFit: candidate.liquidityScore ?? 0,
          payoffFit: assessment.confidence,
          reason: assessment.semanticFitSummary,
        };
      }),
    rejectedCandidates: input.fitAssessments
      .filter((assessment) => assessment.fitStatus !== "validated")
      .map((assessment) => ({
        venue: assessment.venue,
        symbol: assessment.candidateId,
        reason: [assessment.semanticFitSummary, ...assessment.mismatchReasons].filter(Boolean).join(" "),
      })),
    noTradeReason: null,
  });
}

function noSelection(reason: string, fitAssessments: ExpressionFitAssessment[] = []): MarketSelection {
  return MarketSelectionSchema.parse({
    decision: "no_selection",
    selectedMarket: null,
    selectedCandidateId: null,
    rejectionReason: reason,
    rankedCandidates: [],
    rejectedCandidates: fitAssessments.map((assessment) => ({
      venue: assessment.venue,
      symbol: assessment.candidateId,
      reason: [assessment.semanticFitSummary, ...assessment.mismatchReasons].filter(Boolean).join(" "),
    })),
    noTradeReason: reason,
  });
}

function quoteMatchesCandidate(quote: MarketCandidate | PolymarketQuote, candidate: MarketCandidate): boolean {
  const quotedCandidate = MarketCandidateSchema.safeParse(quote);
  if (quotedCandidate.success) {
    return marketCandidateLookupKey(quotedCandidate.data) === marketCandidateLookupKey(candidate);
  }

  const polymarketQuote = PolymarketQuoteSchema.parse(quote);
  return candidate.venue === "polymarket"
    && candidate.conditionId === polymarketQuote.conditionId
    && candidate.outcomeTokenId === polymarketQuote.outcomeTokenId;
}

function predictionMarketSideForCandidate(candidate: MarketCandidate): "yes" | "no" | undefined {
  if (candidate.venue !== "polymarket") return undefined;
  if (candidate.outcome === "no" || candidate.side === "buy_no") return "no";
  return "yes";
}

function candidateAssessmentKeys(candidate: MarketCandidate): string[] {
  return Array.from(new Set([
    `${candidate.venue}:${candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.symbol}:${candidate.instrument}:${candidate.side}`,
    `${candidate.venue}:${candidate.instrument}:${candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.marketSlug ?? candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.conditionId ?? candidate.symbol}:${candidate.side}`,
    marketCandidateLookupKey(candidate),
  ]));
}

function marketCandidateLookupKey(candidate: MarketCandidate): string {
  if (candidate.venue === "polymarket") {
    return [
      candidate.venue,
      candidate.conditionId ?? candidate.marketSlug ?? candidate.symbol,
      candidate.outcomeTokenId ?? candidate.outcome ?? candidate.side,
      candidate.side,
    ].join("|");
  }

  return [
    candidate.venue,
    candidate.symbol,
    candidate.side,
  ].join("|");
}

function normalizedCandidateId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_|]+/gu, ":");
}
