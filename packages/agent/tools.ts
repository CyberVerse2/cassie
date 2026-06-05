import { tool } from "ai";
import { z } from "zod";
import type { CassieDependencies } from "./agent.ts";
import type { CassieStore } from "../core/db/store.ts";
import { config } from "../core/config.ts";
import { withThinkingTraceCapture } from "../ai/client.ts";
import {
  MarketCandidateSchema,
  MarketSelectionSchema,
  OpportunityFrameSchema,
  PolymarketQuoteSchema,
  ExpressionFitAssessmentSchema,
  SourcePostSchema,
  TradeExitPlanSchema,
  TradeExpressionPlanSchema,
  type ControlRun,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type MarketSelection,
  type OpportunityFrame,
  type SourcePost,
  type TradeExpressionPlan,
  type UserSettings,
} from "../core/schemas/index.ts";
import {
  createTradeTicket,
  MIN_HYPERLIQUID_PERP_MARGIN_USD,
} from "../tickets/index.ts";
import { formatTicketCreated, notifyTradeLifecycle } from "../notifications/positions.ts";
import { recordRunStep } from "./steps.ts";
import { prepareFinalInput } from "./public-summary.ts";
import { createRunStepCache } from "./tool-cache.ts";
import { classifySourceMode, frameOpportunity, generateTradeExpressions } from "./reasoning.ts";
import { assessExpressionFit, quoteExpression, searchVenues } from "./venues.ts";
import { thesisForMarketSelection, thesisFromTradeExpression } from "./thesis.ts";
import {
  FinalizeRunInputSchema,
  assertUsableMarketSelection,
  finalizeResult,
  validateFinalizationPrerequisites,
} from "./finalization.ts";

export { frameOpportunity, generateTradeExpressions } from "./reasoning.ts";
export {
  SupervisorPrerequisiteError,
  finalizeRunFromPersistedSteps,
} from "./finalization.ts";

const promptVersion = "2026-05-31";

const PreflightUserPolicySchema = z.object({
  status: z.literal("ok"),
  warnings: z.array(z.string()),
  policy: z.object({
    defaultTradeSizeUsd: z.number(),
    minHyperliquidPerpMarginUsd: z.number(),
    effectiveHyperliquidPerpMarginUsd: z.number(),
    hasWalletAddress: z.boolean(),
  }),
});

export function createCassieSupervisorTools(input: {
  store: CassieStore;
  deps: CassieDependencies;
  run: ControlRun;
  userSettings: UserSettings;
}) {
  const cheapModel = config.ai.cheapModel;
  const importantModel = config.ai.importantModel;
  const cheapAi = input.deps.cheapAi ?? input.deps.ai;
  const importantAi = input.deps.importantAi ?? input.deps.ai;
  if (!cheapAi) {
    throw new Error("Cassie supervisor requires a cheap AI client.");
  }
  if (!importantAi) {
    throw new Error("Cassie supervisor requires an important AI client.");
  }
  const { runStepOnce } = createRunStepCache();

  async function sourceForAnalysis(): Promise<SourcePost> {
    const steps = await input.store.getRunSteps(input.run.runId);
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = steps[index];
      if (step?.stepType !== "intake" || step.status !== "succeeded") continue;
      const resolved = SourcePostSchema.safeParse(step.output);
      if (resolved.success) return resolved.data;
    }
    return input.run.sourcePost;
  }

  return {
    preflight_user_policy: tool({
      description: "Run deterministic user-policy preflight before semantic opportunity analysis.",
      inputSchema: z.object({}),
      execute: async () => runStepOnce("preflight", {}, async () => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "preflight",
        stepInput: {
          userId: input.userSettings.userId,
        },
        execute: async () => preflightUserPolicy(input.userSettings),
      })),
    }),
    classify_source_mode: tool({
      description: "Classify whether the source content is normal or breaking news while preserving user intent.",
      inputSchema: z.object({}),
      execute: async () => runStepOnce("intake", { kind: "source_mode" }, async () => {
        const source = await sourceForAnalysis();
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "intake",
          promptName: "cassie_source_mode_classification",
          promptVersion,
          model: cheapModel,
          stepInput: {
            userCommand: input.run.userCommand,
            sourcePost: source,
          },
          execute: ({ setThinkingTrace }) => classifySourceMode({
            ai: withThinkingTraceCapture(cheapAi, setThinkingTrace),
            sourcePost: source,
            userCommand: input.run.userCommand,
          }),
        });
      }),
    }),
    frame_opportunity: tool({
      description: "Frame the market opportunity implied by the source post without choosing the final trade.",
      inputSchema: z.object({}),
      execute: async () => runStepOnce("opportunity", {}, async () => {
        const source = await sourceForAnalysis();
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "opportunity",
          promptName: "cassie_opportunity_frame",
          promptVersion,
          model: importantModel,
          stepInput: {
            userCommand: input.run.userCommand,
            sourcePost: source,
          },
          execute: ({ setThinkingTrace }) => frameOpportunity({
            ai: withThinkingTraceCapture(importantAi, setThinkingTrace),
            sourcePost: source,
            userCommand: input.run.userCommand,
          }),
        });
      }),
    }),
    resolve_source: tool({
      description: "Resolve a real X/Twitter status URL into Cassie's SourcePost text shape",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      execute: async ({ url }) => runStepOnce("intake", { url }, async () => {
        if (!input.deps.sourceResolver) {
          throw new Error("resolve_source requires a configured source resolver dependency.");
        }
        const output = await recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "intake",
          stepInput: { url },
          execute: ({ setThinkingTrace }) => input.deps.sourceResolver!.resolveSource({
            url,
            onThinkingTrace: setThinkingTrace,
          }),
        });
        const resolved = SourcePostSchema.safeParse(output);
        if (resolved.success) {
          await input.store.updateRun({
            ...input.run,
            sourcePost: resolved.data,
            updatedAt: new Date().toISOString(),
          });
          input.run.sourcePost = resolved.data;
        }
        return output;
      }),
    }),
    generate_trade_expressions: tool({
      description: "Generate candidate trade expressions in one AI step; do not search venues or create a ticket.",
      inputSchema: z.object({
        opportunityFrame: OpportunityFrameSchema.optional(),
        marketCandidates: MarketCandidateSchema.array().optional(),
      }),
      execute: async ({ opportunityFrame, marketCandidates }) => runStepOnce(
        "trade_expression",
        { opportunityFrame, marketCandidates },
        async () => {
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "trade_expression",
            promptName: "cassie_trade_expressions",
            promptVersion,
            model: importantModel,
            stepInput: {
              userCommand: input.run.userCommand,
              sourcePost: await sourceForAnalysis(),
              opportunityFrame,
              marketCandidates,
            },
            execute: async ({ setThinkingTrace }) => {
              const source = await sourceForAnalysis();
              return generateTradeExpressions({
                ai: withThinkingTraceCapture(importantAi, setThinkingTrace),
                sourcePost: source,
                userCommand: input.run.userCommand,
                opportunityFrame,
                marketCandidates,
              });
            },
          });
        },
      ),
    }),
    search_venues: tool({
      description: "Search configured execution and market venues for real candidates matching the trade expression.",
      inputSchema: z.object({
        venues: z.array(z.enum(["hyperliquid", "polymarket"])).optional(),
        limit: z.number().int().positive().max(25).optional(),
      }),
      execute: async ({ venues, limit }) => {
        const tradeExpression = await requireLatestTradeExpression(input.store, input.run.runId);
        return runStepOnce(
        "market_candidates",
        { venues, limit },
        async () => {
          const thesis = thesisFromTradeExpression(tradeExpression);
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "market_candidates",
            stepInput: { venues, limit },
            execute: () => searchVenues({
              marketData: input.deps.marketData,
              polymarket: input.deps.polymarketMarketFinder,
              thesis,
              tradeExpression,
              venues,
              limit,
            }),
          });
        },
        );
      },
    }),
    assess_expression_fit: tool({
      description: "Use AI semantic judgment to assess whether a real venue candidate fits the framed opportunity and intended expression.",
      inputSchema: z.object({
        candidate: MarketCandidateSchema,
        side: z.enum(["yes", "no"]).optional(),
      }),
      execute: async ({ candidate, side }) => {
        const opportunityFrame = await requireLatestOpportunityFrame(input.store, input.run.runId);
        const tradeExpression = await requireLatestTradeExpression(input.store, input.run.runId);
        const persistedCandidate = await resolveLatestMarketCandidate({
          store: input.store,
          runId: input.run.runId,
          candidate,
        });
        const candidateSide = predictionMarketSideForCandidate(persistedCandidate, side);
        return runStepOnce(
          "market_assessment",
          { candidate: persistedCandidate, ...(candidateSide ? { side: candidateSide } : {}) },
          async () => {
            return recordRunStep({
              store: input.store,
              runId: input.run.runId,
              stepType: "market_assessment",
              promptName: "cassie_expression_fit",
              promptVersion,
              model: importantModel,
              stepInput: { candidate: persistedCandidate, ...(candidateSide ? { side: candidateSide } : {}) },
              execute: ({ setThinkingTrace }) => assessExpressionFit({
                ai: withThinkingTraceCapture(importantAi, setThinkingTrace),
                opportunityFrame,
                tradeExpression,
                candidate: persistedCandidate,
                side: candidateSide,
              }),
            });
          },
        );
      },
    }),
    quote_expression: tool({
      description: "Refresh quote data for a validated candidate. Do not quote rejected or unassessed expressions.",
      inputSchema: z.object({
        candidate: MarketCandidateSchema,
        fitAssessment: ExpressionFitAssessmentSchema,
        side: z.enum(["yes", "no"]).optional(),
      }),
      execute: async ({ candidate, fitAssessment, side }) => {
        const persistedCandidate = await resolveLatestMarketCandidate({
          store: input.store,
          runId: input.run.runId,
          candidate,
        });
        const persistedFitAssessment = await resolveLatestFitAssessment({
          store: input.store,
          runId: input.run.runId,
          fitAssessment,
        });
        const candidateSide = predictionMarketSideForCandidate(persistedCandidate, side);
        return runStepOnce(
          "market_quote",
          { candidate: persistedCandidate, fitAssessment: persistedFitAssessment, ...(candidateSide ? { side: candidateSide } : {}) },
          async () => {
            if (persistedFitAssessment.fitStatus !== "validated") {
              throw new Error("quote_expression requires a validated fit assessment.");
            }
            return recordRunStep({
              store: input.store,
              runId: input.run.runId,
              stepType: "market_quote",
              stepInput: { candidate: persistedCandidate, fitAssessment: persistedFitAssessment, ...(candidateSide ? { side: candidateSide } : {}) },
              execute: () => quoteExpression({
                polymarket: input.deps.polymarketMarketFinder,
                candidate: persistedCandidate,
                side: candidateSide,
              }),
            });
          },
        );
      },
    }),
    rank_expressions: tool({
      description: "Rank real venue candidates and choose the best grounded trade expression; do not invent markets.",
      inputSchema: z.object({
        candidates: z.array(z.unknown()).default([]),
        fitAssessments: z.array(z.unknown()).default([]),
        quotes: z.array(z.unknown()).default([]),
      }),
      execute: async ({ candidates, fitAssessments, quotes }) => {
        const tradeExpression = await requireLatestTradeExpression(input.store, input.run.runId);
        const storedCandidates = await latestPersistedMarketCandidates(input.store, input.run.runId);
        const persistedCandidates = storedCandidates.length > 0
          ? storedCandidates
          : parseSuppliedMarketCandidates(candidates);
        const storedFitAssessments = await latestPersistedFitAssessments(input.store, input.run.runId);
        const persistedFitAssessments = storedFitAssessments.length > 0
          ? storedFitAssessments
          : parseSuppliedFitAssessments(fitAssessments);
        const persistedQuotes = await latestPersistedQuotes(input.store, input.run.runId);
        const groundedQuotes = persistedQuotes.length > 0 ? persistedQuotes : parseSuppliedRankQuotes(quotes);
        const validatedFitAssessments = persistedFitAssessments.filter((assessment) => assessment.fitStatus === "validated");
        const selectedFitAssessment = bestFitAssessment(validatedFitAssessments);
        const selectedCandidate = selectedFitAssessment
          ? candidateForFitAssessment(persistedCandidates, selectedFitAssessment)
          : null;
        if (groundedQuotes.length === 0) {
          throw new Error("rank_expressions requires a persisted or supplied market quote.");
        }
        if (!selectedFitAssessment || !selectedCandidate) {
          throw new Error("rank_expressions requires at least one validated venue candidate.");
        }
        if (!groundedQuotes.some((quote) => quoteMatchesCandidate(quote, selectedCandidate))) {
          throw new Error("rank_expressions requires a quote for the best validated venue candidate.");
        }
        const marketSelection = marketSelectionFromBestFit({
          selectedCandidate,
          selectedFitAssessment,
          candidates: persistedCandidates,
          fitAssessments: persistedFitAssessments,
        });

        return runStepOnce(
          "market_selection",
          {
            tradeExpression,
            candidates: [selectedCandidate],
            fitAssessments: persistedFitAssessments,
            quotes: groundedQuotes,
          },
          async () => {
            return recordRunStep({
              store: input.store,
              runId: input.run.runId,
              stepType: "market_selection",
              promptName: null,
              promptVersion: null,
              model: null,
              stepInput: {
                tradeExpression,
                candidates: [selectedCandidate],
                fitAssessments: persistedFitAssessments,
                quotes: groundedQuotes,
              },
              execute: async () => marketSelection,
            });
          },
        );
      },
    }),
    create_trade_ticket: tool({
      description: "Create a trade ticket from the selected market using the user's configured default trade size and an explicit exit plan. This never executes the order directly.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema.nullable().default(null),
        marketSelection: z.unknown().nullable().default(null),
        exitPlan: TradeExitPlanSchema,
      }),
      execute: async ({ tradeExpression, marketSelection, exitPlan }) => {
        const persistedTradeExpression = await latestPersistedTradeExpression(input.store, input.run.runId)
          ?? parseSuppliedTradeExpression(tradeExpression);
        const persistedMarketSelection = await latestPersistedMarketSelection(input.store, input.run.runId)
          ?? parseSuppliedMarketSelection(marketSelection);
        return runStepOnce(
          "ticket",
          {
            tradeExpression: persistedTradeExpression,
            marketSelection: persistedMarketSelection,
          },
          async () => {
            assertUsableMarketSelection(persistedMarketSelection);
            const thesis = thesisForMarketSelection(persistedTradeExpression, persistedMarketSelection);
            return recordRunStep({
              store: input.store,
              runId: input.run.runId,
              stepType: "ticket",
              stepInput: {
                tradeExpression: persistedTradeExpression,
                marketSelection: persistedMarketSelection,
              },
              execute: async () => {
                const ticket = createTradeTicket({
                  runId: input.run.runId,
                  userSettings: input.userSettings,
                  thesis,
                  marketSelection: persistedMarketSelection,
                  exitPlan,
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
          },
        );
      },
    }),
    finalize_run: tool({
      description: "Finalize the Cassie run with the user-facing result after analysis, no-trade, or trade-ticket creation.",
      inputSchema: FinalizeRunInputSchema,
      execute: async (finalInput) => runStepOnce("final", finalInput, async () => {
        const preparedFinalInput = prepareFinalInput(finalInput);
        validateFinalizationPrerequisites(preparedFinalInput);
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "final",
          stepInput: preparedFinalInput,
          execute: async () => {
            const result = finalizeResult(preparedFinalInput);
            const updated = {
              ...input.run,
              status: "succeeded" as const,
              result,
              error: null,
              updatedAt: new Date().toISOString(),
            };
            await input.store.updateRun(updated);
            return updated.result;
          },
        });
      }),
    }),
  };
}

async function resolveLatestMarketCandidate(input: {
  store: CassieStore;
  runId: string;
  candidate: MarketCandidate;
}): Promise<MarketCandidate> {
  const candidates = await latestPersistedMarketCandidates(input.store, input.runId);

  const requestedKey = marketCandidateLookupKey(input.candidate);
  const matches = candidates.filter((candidate) => marketCandidateLookupKey(candidate) === requestedKey);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`Candidate ${requestedKey} is ambiguous across latest venue-search results.`);
  }
  throw new Error(`Candidate ${requestedKey} was not found in persisted venue-search results.`);
}

async function latestPersistedMarketCandidates(store: CassieStore, runId: string): Promise<MarketCandidate[]> {
  const latestStep = await latestSucceededStep(store, runId, "market_candidates");
  return latestStep
    ? MarketCandidateSchema.array().parse(latestStep.output)
    : [];
}

async function latestPersistedFitAssessments(store: CassieStore, runId: string): Promise<ExpressionFitAssessment[]> {
  const steps = await store.getRunSteps(runId);
  return steps
    .filter((step) => step.stepType === "market_assessment" && step.status === "succeeded")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((step) => ExpressionFitAssessmentSchema.parse(step.output));
}

async function latestPersistedMarketSelection(store: CassieStore, runId: string): Promise<MarketSelection | null> {
  const latestStep = await latestSucceededStep(store, runId, "market_selection");
  return latestStep
    ? MarketSelectionSchema.parse(latestStep.output)
    : null;
}

async function latestPersistedOpportunityFrame(store: CassieStore, runId: string): Promise<OpportunityFrame | null> {
  const latestStep = await latestSucceededStep(store, runId, "opportunity");
  return latestStep
    ? OpportunityFrameSchema.parse(latestStep.output)
    : null;
}

async function requireLatestOpportunityFrame(store: CassieStore, runId: string): Promise<OpportunityFrame> {
  const opportunityFrame = await latestPersistedOpportunityFrame(store, runId);
  if (!opportunityFrame) {
    throw new Error("assess_expression_fit requires a persisted opportunity frame from frame_opportunity.");
  }
  return opportunityFrame;
}

async function latestPersistedTradeExpression(store: CassieStore, runId: string) {
  const latestStep = await latestSucceededStep(store, runId, "trade_expression");
  return latestStep
    ? TradeExpressionPlanSchema.parse(latestStep.output)
    : null;
}

async function requireLatestTradeExpression(store: CassieStore, runId: string): Promise<TradeExpressionPlan> {
  const tradeExpression = await latestPersistedTradeExpression(store, runId);
  if (!tradeExpression) {
    throw new Error("This tool requires a persisted trade expression from generate_trade_expressions.");
  }
  return tradeExpression;
}

async function latestPersistedQuotes(store: CassieStore, runId: string): Promise<unknown[]> {
  const steps = await store.getRunSteps(runId);
  return steps
    .filter((step) => step.stepType === "market_quote" && step.status === "succeeded")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((step) => step.output)
    .filter((quote) => quote !== null && quote !== undefined);
}

function parseSuppliedMarketCandidates(value: unknown): MarketCandidate[] {
  const parsed = MarketCandidateSchema.array().safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("rank_expressions requires real venue candidates from search_venues.");
}

function parseSuppliedFitAssessments(value: unknown): ExpressionFitAssessment[] {
  const parsed = ExpressionFitAssessmentSchema.array().safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("rank_expressions requires expression-fit assessments from assess_expression_fit.");
}

function parseSuppliedRankQuotes(value: unknown): unknown[] {
  const parsed = z.array(z.union([MarketCandidateSchema, PolymarketQuoteSchema])).safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("rank_expressions requires quotes from quote_expression.");
}

function parseSuppliedMarketSelection(value: unknown): MarketSelection {
  const parsed = MarketSelectionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("Trade ticket creation requires a usable market selection.");
}

function bestFitAssessment(fitAssessments: ExpressionFitAssessment[]): ExpressionFitAssessment | null {
  return [...fitAssessments]
    .sort((left, right) => right.fitScore - left.fitScore)[0] ?? null;
}

function candidateForFitAssessment(
  candidates: MarketCandidate[],
  fitAssessment: ExpressionFitAssessment,
): MarketCandidate {
  const match = candidates.find((candidate) =>
    marketCandidateAssessmentKeys(candidate).some((key) =>
      normalizedCandidateId(key) === normalizedCandidateId(fitAssessment.candidateId)
    )
  );
  if (!match) {
    throw new Error(`Validated candidate ${fitAssessment.candidateId} was not found in persisted venue-search results.`);
  }
  return match;
}

function quoteMatchesCandidate(quote: unknown, candidate: MarketCandidate): boolean {
  const quotedCandidate = MarketCandidateSchema.safeParse(quote);
  if (quotedCandidate.success) {
    return marketCandidateLookupKey(quotedCandidate.data) === marketCandidateLookupKey(candidate);
  }

  const polymarketQuote = PolymarketQuoteSchema.safeParse(quote);
  if (!polymarketQuote.success || candidate.venue !== "polymarket") {
    return false;
  }

  return Boolean(
    candidate.conditionId === polymarketQuote.data.conditionId &&
      candidate.outcomeTokenId === polymarketQuote.data.outcomeTokenId,
  );
}

function marketSelectionFromBestFit(input: {
  selectedCandidate: MarketCandidate;
  selectedFitAssessment: ExpressionFitAssessment;
  candidates: MarketCandidate[];
  fitAssessments: ExpressionFitAssessment[];
}): MarketSelection {
  const rankedCandidates = input.fitAssessments
    .filter((assessment) => assessment.fitStatus === "validated")
    .sort((left, right) => right.fitScore - left.fitScore)
    .map((assessment) => {
      const candidate = candidateForFitAssessment(input.candidates, assessment);
      return {
        candidateId: assessment.candidateId,
        venue: candidate.venue,
        symbol: candidate.symbol,
        thesisFit: assessment.fitScore,
        liquidityFit: candidate.liquidityScore ?? 0,
        payoffFit: assessment.confidence,
        reason: assessment.semanticFitSummary,
      };
    });
  const rejectedCandidates = input.fitAssessments
    .filter((assessment) => assessment.fitStatus !== "validated")
    .map((assessment) => ({
      venue: assessment.venue,
      symbol: assessment.candidateId,
      reason: [
        assessment.semanticFitSummary,
        ...assessment.mismatchReasons,
      ].filter(Boolean).join(" "),
    }));

  return MarketSelectionSchema.parse({
    decision: "select_market",
    selectedMarket: input.selectedCandidate,
    selectedCandidateId: input.selectedFitAssessment.candidateId,
    rejectionReason: null,
    rankedCandidates,
    rejectedCandidates,
    noTradeReason: null,
  });
}

function marketCandidateAssessmentKeys(candidate: MarketCandidate): string[] {
  return Array.from(new Set([
    `${candidate.venue}:${candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.symbol}:${candidate.instrument}:${candidate.side}`,
    `${candidate.venue}:${candidate.instrument}:${candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.marketSlug ?? candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.marketSlug ?? candidate.symbol}:${candidate.instrument}:${candidate.side}`,
    `${candidate.venue}:${candidate.instrument}:${candidate.marketSlug ?? candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.conditionId ?? candidate.symbol}:${candidate.side}`,
    `${candidate.venue}:${candidate.conditionId ?? candidate.symbol}:${candidate.instrument}:${candidate.side}`,
    `${candidate.venue}:${candidate.instrument}:${candidate.conditionId ?? candidate.symbol}:${candidate.side}`,
    marketCandidateLookupKey(candidate),
  ]));
}

function normalizedCandidateId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_|]+/gu, ":");
}

function parseSuppliedTradeExpression(value: unknown) {
  const parsed = TradeExpressionPlanSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("Trade ticket creation requires a persisted or supplied trade expression.");
}

async function latestSucceededStep(
  store: CassieStore,
  runId: string,
  stepType: "market_candidates" | "market_selection" | "opportunity" | "trade_expression",
) {
  const steps = await store.getRunSteps(runId);
  return steps
    .filter((step) => step.stepType === stepType && step.status === "succeeded")
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null;
}

async function resolveLatestFitAssessment(input: {
  store: CassieStore;
  runId: string;
  fitAssessment: ExpressionFitAssessment;
}): Promise<ExpressionFitAssessment> {
  const assessments = await latestPersistedFitAssessments(input.store, input.runId);
  const match = assessments.find((assessment) =>
    normalizedCandidateId(assessment.candidateId) === normalizedCandidateId(input.fitAssessment.candidateId)
    && assessment.expressionId === input.fitAssessment.expressionId
    && assessment.venue === input.fitAssessment.venue
    && assessment.fitStatus === input.fitAssessment.fitStatus,
  );

  if (match) return match;
  throw new Error(`Fit assessment ${input.fitAssessment.candidateId} was not found in persisted expression-fit results.`);
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

function predictionMarketSideForCandidate(candidate: MarketCandidate, side?: "yes" | "no") {
  return candidate.venue === "polymarket" ? side : undefined;
}

function preflightUserPolicy(userSettings: UserSettings) {
  const warnings: string[] = [];
  if (!userSettings.walletAddress) {
    warnings.push("No wallet address is configured; order submission needs wallet setup.");
  }

  return PreflightUserPolicySchema.parse({
    status: "ok",
    warnings,
    policy: {
      defaultTradeSizeUsd: userSettings.defaultTradeSizeUsd,
      minHyperliquidPerpMarginUsd: MIN_HYPERLIQUID_PERP_MARGIN_USD,
      effectiveHyperliquidPerpMarginUsd: Math.max(userSettings.defaultTradeSizeUsd, MIN_HYPERLIQUID_PERP_MARGIN_USD),
      hasWalletAddress: Boolean(userSettings.walletAddress),
    },
  });
}
