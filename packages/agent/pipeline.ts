import {
  withThinkingTraceCapture,
  type StructuredAiClient,
} from "../ai/client.ts";
import type { CassieStore } from "../core/db/store.ts";
import {
  MarketSelectionSchema,
  SourcePostSchema,
  TradeExitPlanSchema,
  type ControlRun,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type MarketSelection,
  type OpportunityFrame,
  type SourcePost,
  type SupervisorFinalResult,
  type TradeExpressionPlan,
  type UserSettings,
} from "../core/schemas/index.ts";
import {
  MIN_HYPERLIQUID_PERP_MARGIN_USD,
  createTradeTicket,
} from "../tickets/index.ts";
import {
  formatTicketCreated,
  notifyTradeLifecycle,
} from "../notifications/positions.ts";
import type { CassieDependencies } from "./agent.ts";
import { finalizeRunFromPersistedSteps } from "./finalization.ts";
import { recordRunStep } from "./steps.ts";
import { prepareFinalInput } from "./public-summary.ts";
import {
  finalizeResult,
  validateFinalizationPrerequisites,
} from "./finalization.ts";
import {
  planOpportunityAndTradeExpressions,
  classifySourceMode,
} from "./reasoning.ts";
import {
  assessExpressionFit,
  quoteExpression,
  searchVenues,
} from "./venues.ts";
import {
  thesisForMarketSelection,
  thesisFromTradeExpression,
} from "./thesis.ts";
import { config } from "../core/config.ts";

const promptVersion = "2026-05-31";
const MAX_PIPELINE_ASSESSMENTS = 5;

export async function runCassieSupervisorPipeline(input: {
  store: CassieStore;
  run: ControlRun;
  userSettings: UserSettings;
  deps: CassieDependencies;
}): Promise<SupervisorFinalResult> {
  const cheapAi = input.deps.cheapAi ?? input.deps.ai;
  const importantAi = input.deps.importantAi ?? input.deps.ai;
  if (!cheapAi)
    throw new Error("Cassie supervisor pipeline requires a cheap AI client.");
  if (!importantAi)
    throw new Error(
      "Cassie supervisor pipeline requires an important AI client.",
    );

  await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "preflight",
    stepInput: { userId: input.userSettings.userId },
    execute: async () => preflightUserPolicy(input.userSettings),
  });

  const source = await sourceForPipeline({
    store: input.store,
    run: input.run,
    sourceResolver: input.deps.sourceResolver,
  });

  await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "intake",
    promptName: "cassie_source_mode_classification",
    promptVersion,
    model: config.ai.cheapModel,
    stepInput: {
      userCommand: input.run.userCommand,
      sourcePost: source,
    },
    execute: ({ setThinkingTrace }) =>
      classifySourceMode({
        ai: withThinkingTraceCapture(cheapAi, setThinkingTrace),
        sourcePost: source,
        userCommand: input.run.userCommand,
      }),
  });

  const opportunityPlan = await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "opportunity",
    promptName: "cassie_opportunity_trade_plan",
    promptVersion,
    model: config.ai.importantModel,
    stepInput: {
      userCommand: input.run.userCommand,
      sourcePost: source,
    },
    execute: ({ setThinkingTrace }) =>
      planOpportunityAndTradeExpressions({
        ai: withThinkingTraceCapture(importantAi, setThinkingTrace),
        sourcePost: source,
        userCommand: input.run.userCommand,
      }),
  });

  const opportunityFrame = opportunityPlan.opportunityFrame;
  const tradeExpression = await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "trade_expression",
    promptName: "cassie_opportunity_trade_plan",
    promptVersion,
    model: config.ai.importantModel,
    stepInput: {
      derivedFromStepType: "opportunity",
      userCommand: input.run.userCommand,
      sourcePost: source,
      opportunityFrame,
    },
    execute: async () => opportunityPlan.tradeExpression,
  });

  if (tradeExpression.decision === "no_trade") {
    return finalizePipelineRun({
      store: input.store,
      run: input.run,
      responseType: "analysis",
      publicSummary: tradeExpression.reason,
      tradeExpression,
    });
  }

  const marketCandidates = await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "market_candidates",
    stepInput: { venues: undefined, limit: undefined },
    execute: () =>
      searchVenues({
        hyperliquidMarketData: input.deps.hyperliquidMarketData,
        polymarket: input.deps.polymarketMarketFinder,
        thesis: thesisFromTradeExpression(tradeExpression),
        tradeExpression,
      }),
  });

  if (marketCandidates.length === 0) {
    const marketSelection = await recordNoSelection({
      store: input.store,
      runId: input.run.runId,
      reason: "No configured venue candidates matched the trade expression.",
    });
    return finalizePipelineRun({
      store: input.store,
      run: input.run,
      responseType: "analysis",
      publicSummary: marketSelection.noTradeReason ?? tradeExpression.reason,
      tradeExpression,
      marketSelection,
    });
  }

  const fitAssessments = await assessCandidates({
    store: input.store,
    run: input.run,
    ai: importantAi,
    opportunityFrame,
    tradeExpression,
    candidates: marketCandidates,
  });
  const validatedFitAssessments = fitAssessments.filter(
    (assessment) => assessment.fitStatus === "validated",
  );
  const selectedFitAssessment = bestFitAssessment(validatedFitAssessments);
  if (!selectedFitAssessment) {
    const bestRejected = bestFitAssessment(fitAssessments);
    const reason =
      bestRejected?.semanticFitSummary ??
      "No venue candidate validated against the trade expression.";
    const marketSelection = await recordNoSelection({
      store: input.store,
      runId: input.run.runId,
      reason,
      rejectedFit: bestRejected,
    });
    return finalizePipelineRun({
      store: input.store,
      run: input.run,
      responseType: "analysis",
      publicSummary: reason,
      tradeExpression,
      marketSelection,
    });
  }

  const selectedCandidate = candidateForFitAssessment(
    marketCandidates,
    selectedFitAssessment,
  );
  const quote = await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "market_quote",
    stepInput: {
      candidate: selectedCandidate,
      fitAssessment: selectedFitAssessment,
      side: predictionMarketSideForCandidate(selectedCandidate),
    },
    execute: () =>
      quoteExpression({
        polymarket: input.deps.polymarketMarketFinder,
        candidate: selectedCandidate,
        side: predictionMarketSideForCandidate(selectedCandidate),
      }),
  });

  const marketSelection = await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "market_selection",
    stepInput: {
      tradeExpression,
      candidates: [selectedCandidate],
      fitAssessments,
      quotes: [quote],
    },
    execute: async () =>
      marketSelectionFromBestFit({
        selectedCandidate,
        selectedFitAssessment,
        candidates: marketCandidates,
        fitAssessments,
      }),
  });

  if (
    opportunityFrame.userIntent !== "trade" ||
    !marketSelection.selectedMarket
  ) {
    return finalizePipelineRun({
      store: input.store,
      run: input.run,
      responseType: "analysis",
      publicSummary: tradeExpression.reason,
      tradeExpression,
      marketSelection,
    });
  }

  const ticket = await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "ticket",
    stepInput: {
      tradeExpression,
      marketSelection,
    },
    execute: async () => {
      const created = createTradeTicket({
        runId: input.run.runId,
        userSettings: input.userSettings,
        thesis: thesisForMarketSelection(tradeExpression, marketSelection),
        marketSelection,
        exitPlan: defaultExitPlan({ tradeExpression, marketSelection }),
      });
      await input.store.addTradeTicket(created);
      await notifyTradeLifecycle({
        store: input.store,
        settings: input.userSettings,
        text: formatTicketCreated(created),
        entityId: created.ticketId,
        eventType: "telegram.ticket_created_failed",
      });
      return created;
    },
  });

  return finalizePipelineRun({
    store: input.store,
    run: input.run,
    responseType: "trade_ticket",
    publicSummary: `Created a trade ticket for ${marketSelection.selectedMarket.side} ${marketSelection.selectedMarket.symbol} on ${marketSelection.selectedMarket.venue}.`,
    tradeExpression,
    marketSelection,
    tradeTicket: { ticketId: ticket.ticketId },
  });
}

async function sourceForPipeline(input: {
  store: CassieStore;
  run: ControlRun;
  sourceResolver?: CassieDependencies["sourceResolver"];
}): Promise<SourcePost> {
  const url =
    xStatusUrl(input.run.sourcePost.url) ?? xStatusUrl(input.run.userCommand);
  if (
    !url ||
    !input.sourceResolver ||
    hasSubstantiveSourceText(input.run.sourcePost, url)
  ) {
    return input.run.sourcePost;
  }

  const resolved = await recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "intake",
    stepInput: { url },
    execute: ({ setThinkingTrace }) =>
      input.sourceResolver!.resolveSource({
        url,
        onThinkingTrace: setThinkingTrace,
      }),
  });
  const source = SourcePostSchema.parse(resolved);
  await input.store.updateRun({
    ...input.run,
    sourcePost: source,
    updatedAt: new Date().toISOString(),
  });
  input.run.sourcePost = source;
  return source;
}

function xStatusUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return (
    value.match(/https:\/\/(?:x|twitter)\.com\/[^\s/]+\/status\/\d+/u)?.[0] ??
    null
  );
}

function hasSubstantiveSourceText(source: SourcePost, url: string): boolean {
  const text = source.text.trim();
  return text.length > 40 && text !== url && !text.includes(url);
}

async function assessCandidates(input: {
  store: CassieStore;
  run: ControlRun;
  ai: StructuredAiClient;
  opportunityFrame: OpportunityFrame;
  tradeExpression: TradeExpressionPlan;
  candidates: MarketCandidate[];
}): Promise<ExpressionFitAssessment[]> {
  const candidates = input.candidates.slice(0, MAX_PIPELINE_ASSESSMENTS);
  return Promise.all(
    candidates.map((candidate) =>
      recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "market_assessment",
        promptName: "cassie_expression_fit",
        promptVersion,
        model: config.ai.importantModel,
        stepInput: {
          candidate,
          side: predictionMarketSideForCandidate(candidate),
        },
        execute: ({ setThinkingTrace }) =>
          assessExpressionFit({
            ai: withThinkingTraceCapture(input.ai, setThinkingTrace),
            opportunityFrame: input.opportunityFrame,
            tradeExpression: input.tradeExpression,
            candidate,
            side: predictionMarketSideForCandidate(candidate),
          }),
      }),
    ),
  );
}

async function recordNoSelection(input: {
  store: CassieStore;
  runId: string;
  reason: string;
  rejectedFit?: ExpressionFitAssessment | null;
}): Promise<MarketSelection> {
  return recordRunStep({
    store: input.store,
    runId: input.runId,
    stepType: "market_selection",
    stepInput: { reason: input.reason, rejectedFit: input.rejectedFit ?? null },
    execute: async () =>
      MarketSelectionSchema.parse({
        decision: "no_selection",
        selectedMarket: null,
        selectedCandidateId: input.rejectedFit?.candidateId ?? null,
        rejectionReason: input.reason,
        rankedCandidates: [],
        rejectedCandidates: input.rejectedFit
          ? [
              {
                venue: input.rejectedFit.venue,
                symbol: input.rejectedFit.candidateId,
                reason: [
                  input.rejectedFit.semanticFitSummary,
                  ...input.rejectedFit.mismatchReasons,
                ]
                  .filter(Boolean)
                  .join(" "),
              },
            ]
          : [],
        noTradeReason: input.reason,
      }),
  });
}

async function finalizePipelineRun(input: {
  store: CassieStore;
  run: ControlRun;
  responseType: "analysis" | "trade_ticket";
  publicSummary: string;
  tradeExpression?: TradeExpressionPlan;
  marketSelection?: MarketSelection;
  tradeTicket?: { ticketId: string };
}): Promise<SupervisorFinalResult> {
  const finalInput = prepareFinalInput({
    responseType: input.responseType,
    publicSummary: input.publicSummary,
    tradeExpression: input.tradeExpression,
    marketSelection: input.marketSelection,
    tradeTicket: input.tradeTicket,
  });
  validateFinalizationPrerequisites(finalInput);
  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "final",
    stepInput: finalInput,
    execute: async () => {
      const result = finalizeResult(finalInput);
      await input.store.updateRun({
        ...input.run,
        status: "succeeded" as const,
        result,
        error: null,
        updatedAt: new Date().toISOString(),
      });
      return result;
    },
  });
}

function preflightUserPolicy(userSettings: UserSettings) {
  return {
    status: "ok" as const,
    warnings: userSettings.walletAddress
      ? []
      : [
          "No wallet address is configured; order submission needs wallet setup.",
        ],
    policy: {
      defaultTradeSizeUsd: userSettings.defaultTradeSizeUsd,
      minHyperliquidPerpMarginUsd: MIN_HYPERLIQUID_PERP_MARGIN_USD,
      effectiveHyperliquidPerpMarginUsd: userSettings.defaultTradeSizeUsd,
      hasWalletAddress: Boolean(userSettings.walletAddress),
    },
  };
}

function bestFitAssessment(
  fitAssessments: ExpressionFitAssessment[],
): ExpressionFitAssessment | null {
  return (
    [...fitAssessments].sort(
      (left, right) => right.fitScore - left.fitScore,
    )[0] ?? null
  );
}

function candidateForFitAssessment(
  candidates: MarketCandidate[],
  fitAssessment: ExpressionFitAssessment,
): MarketCandidate {
  const match = candidates.find((candidate) =>
    marketCandidateAssessmentKeys(candidate).some(
      (key) =>
        normalizedCandidateId(key) ===
        normalizedCandidateId(fitAssessment.candidateId),
    ),
  );
  if (!match) {
    throw new Error(
      `Validated candidate ${fitAssessment.candidateId} was not found in venue-search results.`,
    );
  }
  return match;
}

function marketSelectionFromBestFit(input: {
  selectedCandidate: MarketCandidate;
  selectedFitAssessment: ExpressionFitAssessment;
  candidates: MarketCandidate[];
  fitAssessments: ExpressionFitAssessment[];
}): MarketSelection {
  return MarketSelectionSchema.parse({
    decision: "select_market",
    selectedMarket: input.selectedCandidate,
    selectedCandidateId: input.selectedFitAssessment.candidateId,
    rejectionReason: null,
    rankedCandidates: input.fitAssessments
      .filter((assessment) => assessment.fitStatus === "validated")
      .sort((left, right) => right.fitScore - left.fitScore)
      .map((assessment) => {
        const candidate = candidateForFitAssessment(
          input.candidates,
          assessment,
        );
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
        reason: [assessment.semanticFitSummary, ...assessment.mismatchReasons]
          .filter(Boolean)
          .join(" "),
      })),
    noTradeReason: null,
  });
}

function marketCandidateAssessmentKeys(candidate: MarketCandidate): string[] {
  return Array.from(
    new Set([
      `${candidate.venue}:${candidate.symbol}:${candidate.side}`,
      `${candidate.venue}:${candidate.symbol}:${candidate.instrument}:${candidate.side}`,
      `${candidate.venue}:${candidate.instrument}:${candidate.symbol}:${candidate.side}`,
      `${candidate.venue}:${candidate.marketSlug ?? candidate.symbol}:${candidate.side}`,
      `${candidate.venue}:${candidate.conditionId ?? candidate.symbol}:${candidate.side}`,
      marketCandidateLookupKey(candidate),
    ]),
  );
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
  return [candidate.venue, candidate.symbol, candidate.side].join("|");
}

function normalizedCandidateId(value: string): string {
  return value.trim().toLowerCase().replace(/[_|]+/gu, ":");
}

function predictionMarketSideForCandidate(
  candidate: MarketCandidate,
): "yes" | "no" | undefined {
  if (candidate.venue !== "polymarket") return undefined;
  if (candidate.outcome === "no" || candidate.side === "buy_no") return "no";
  return "yes";
}

function defaultExitPlan(input: {
  tradeExpression: TradeExpressionPlan;
  marketSelection: MarketSelection;
}) {
  const market = input.marketSelection.selectedMarket;
  return TradeExitPlanSchema.parse({
    takeProfitPct: 10,
    stopLossPct: 5,
    maxHoldDays: 7,
    reviewCadence: "daily",
    thesis: market?.reason ?? input.tradeExpression.highestPurityExpression,
    invalidationSignals: Array.from(
      new Set([
        ...(input.tradeExpression.insufficiency?.evidenceNeededToClear ?? []),
        "The selected venue quote or liquidity deteriorates materially.",
      ]),
    ).slice(0, 6),
  });
}

export async function finalizePipelineFromPersistedSteps(input: {
  store: CassieStore;
  run: ControlRun;
}) {
  return finalizeRunFromPersistedSteps(input);
}
