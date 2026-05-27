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
  TradeExpressionPlanSchema,
  XSentimentAssessmentSchema,
  type ControlRun,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type MarketSelection,
  type UserSettings,
} from "../core/schemas/index.ts";
import { selectMarket } from "../adapters/selection.ts";
import { createTradeTicket } from "../tickets/index.ts";
import { recordRunStep } from "./steps.ts";
import { prepareFinalInput } from "./public-summary.ts";
import { createRunStepCache } from "./tool-cache.ts";
import { frameOpportunity, generateTradeExpressions } from "./reasoning.ts";
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

const promptVersion = "2026-05-24";

const PreflightUserPolicySchema = z.object({
  status: z.literal("ok"),
  warnings: z.array(z.string()),
  policy: z.object({
    defaultTradeSizeUsd: z.number(),
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
    frame_opportunity: tool({
      description: "Frame the market opportunity implied by the source post without choosing the final trade.",
      inputSchema: z.object({
        sourcePost: SourcePostSchema.optional(),
      }),
      execute: async ({ sourcePost }) => runStepOnce("opportunity", { sourcePost }, async () => {
        const source = sourcePost ?? input.run.sourcePost;
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
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "intake",
          stepInput: { url },
          execute: ({ setThinkingTrace }) => input.deps.sourceResolver!.resolveSource({
            url,
            onThinkingTrace: setThinkingTrace,
          }),
        });
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
              sourcePost: input.run.sourcePost,
              opportunityFrame,
              marketCandidates,
            },
            execute: ({ setThinkingTrace }) => generateTradeExpressions({
              ai: withThinkingTraceCapture(importantAi, setThinkingTrace),
              sourcePost: input.run.sourcePost,
              userCommand: input.run.userCommand,
              opportunityFrame,
              marketCandidates,
            }),
          });
        },
      ),
    }),
    search_venues: tool({
      description: "Search configured execution and market venues for real candidates matching the trade expression.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        venues: z.array(z.enum(["hyperliquid", "polymarket"])).optional(),
        limit: z.number().int().positive().max(25).optional(),
      }),
      execute: async ({ tradeExpression, venues, limit }) => runStepOnce(
        "market_candidates",
        { tradeExpression, venues, limit },
        async () => {
          const thesis = thesisFromTradeExpression(tradeExpression);
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "market_candidates",
            stepInput: { tradeExpression, venues, limit },
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
      ),
    }),
    assess_expression_fit: tool({
      description: "Use AI semantic judgment to assess whether a real venue candidate fits the framed opportunity and intended expression.",
      inputSchema: z.object({
        opportunityFrame: OpportunityFrameSchema,
        tradeExpression: TradeExpressionPlanSchema,
        candidate: MarketCandidateSchema,
        side: z.enum(["yes", "no"]).optional(),
      }),
      execute: async ({ opportunityFrame, tradeExpression, candidate, side }) => {
        const persistedCandidate = await resolveLatestMarketCandidate({
          store: input.store,
          runId: input.run.runId,
          candidate,
        });
        const candidateSide = predictionMarketSideForCandidate(persistedCandidate, side);
        return runStepOnce(
          "market_assessment",
          { opportunityFrame, tradeExpression, candidate: persistedCandidate, ...(candidateSide ? { side: candidateSide } : {}) },
          async () => {
            return recordRunStep({
              store: input.store,
              runId: input.run.runId,
              stepType: "market_assessment",
              promptName: "cassie_expression_fit",
              promptVersion,
              model: importantModel,
              stepInput: { opportunityFrame, tradeExpression, candidate: persistedCandidate, ...(candidateSide ? { side: candidateSide } : {}) },
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
    check_x_sentiment: tool({
      description: "Check X-only sentiment, novelty, crowding, and correction risk for the framed opportunity.",
      inputSchema: z.object({
        sourcePost: SourcePostSchema.nullable().default(null),
        opportunityFrame: OpportunityFrameSchema,
        tradeExpression: TradeExpressionPlanSchema.nullable().default(null),
        fitAssessment: ExpressionFitAssessmentSchema.nullable().default(null),
        candidate: MarketCandidateSchema.nullable().default(null),
      }),
      execute: async ({ sourcePost, opportunityFrame, tradeExpression, fitAssessment, candidate }) => runStepOnce(
        "x_sentiment",
        {
          sourcePost,
          opportunityFrame,
          tradeExpression: tradeExpression ?? null,
          fitAssessment: fitAssessment ?? null,
          candidate: candidate ?? null,
        },
        async () => {
          if (!input.deps.xSentimentProvider) {
            throw new Error("check_x_sentiment requires a configured X sentiment provider dependency.");
          }
          const source = sourcePost ?? input.run.sourcePost;
          const expressionContext = tradeExpression ?? null;
          const fitContext = fitAssessment ?? null;
          const candidateContext = candidate ?? null;
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "x_sentiment",
            promptName: "cassie_x_sentiment",
            promptVersion,
            model: config.ai.grokXSearchModel,
            stepInput: {
              sourcePost: source,
              opportunityFrame,
              tradeExpression: expressionContext,
              fitAssessment: fitContext,
              candidate: candidateContext,
            },
            execute: ({ setThinkingTrace }) => input.deps.xSentimentProvider!.checkXSentiment({
              sourcePost: source,
              opportunityFrame,
              tradeExpression: expressionContext,
              fitAssessment: fitContext,
              candidate: candidateContext,
              onThinkingTrace: setThinkingTrace,
            }),
          });
        },
      ),
    }),
    rank_expressions: tool({
      description: "Rank real venue candidates and choose the best grounded trade expression; do not invent markets.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        candidates: z.array(z.unknown()).default([]),
        fitAssessments: z.array(z.unknown()).default([]),
        quotes: z.array(z.unknown()).default([]),
        xSentiment: XSentimentAssessmentSchema.nullable().default(null),
      }),
      execute: async ({ tradeExpression, candidates, fitAssessments, quotes, xSentiment }) => {
        const storedCandidates = await latestPersistedMarketCandidates(input.store, input.run.runId);
        const persistedCandidates = storedCandidates.length > 0
          ? storedCandidates
          : parseSuppliedMarketCandidates(candidates);
        const storedFitAssessments = await latestPersistedFitAssessments(input.store, input.run.runId);
        const persistedFitAssessments = storedFitAssessments.length > 0
          ? storedFitAssessments
          : parseSuppliedFitAssessments(fitAssessments);
        const persistedQuotes = await latestPersistedQuotes(input.store, input.run.runId);
        const persistedXSentiment = xSentiment
          ?? await latestPersistedXSentiment(input.store, input.run.runId);
        const groundedQuotes = persistedQuotes.length > 0 ? persistedQuotes : parseSuppliedRankQuotes(quotes);
        const validatedFitAssessments = persistedFitAssessments.filter((assessment) => assessment.fitStatus === "validated");
        const rankingCandidates = persistedCandidates
          .slice(0, persistedFitAssessments.length)
          .filter((_, index) => persistedFitAssessments[index]?.fitStatus === "validated");
        if (groundedQuotes.length === 0) {
          throw new Error("rank_expressions requires a persisted or supplied market quote.");
        }
        if (validatedFitAssessments.length > groundedQuotes.length) {
          throw new Error("rank_expressions requires quotes for every validated venue candidate.");
        }
        if (rankingCandidates.length === 0) {
          throw new Error("rank_expressions requires at least one validated venue candidate.");
        }

        return runStepOnce(
          "market_selection",
          {
            tradeExpression,
            candidates: rankingCandidates,
            fitAssessments: persistedFitAssessments,
            quotes: groundedQuotes,
            xSentiment: persistedXSentiment,
          },
          async () => {
            const thesis = thesisFromTradeExpression(tradeExpression);
            return recordRunStep({
              store: input.store,
              runId: input.run.runId,
              stepType: "market_selection",
              promptName: "cassie_market_selection",
              promptVersion,
              model: cheapModel,
              stepInput: {
                tradeExpression,
                candidates: rankingCandidates,
                fitAssessments: persistedFitAssessments,
                quotes: groundedQuotes,
                xSentiment: persistedXSentiment,
              },
              execute: ({ setThinkingTrace }) => selectMarket({
                ai: withThinkingTraceCapture(cheapAi, setThinkingTrace),
                marketData: input.deps.marketData,
                thesis,
                tradeExpression,
                candidates: rankingCandidates,
                fitAssessments: persistedFitAssessments,
                quotes: groundedQuotes,
                xSentiment: persistedXSentiment,
              }),
            });
          },
        );
      },
    }),
    create_trade_ticket: tool({
      description: "Create a trade ticket from the selected market using the user's configured default trade size. This never executes the order directly.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema.nullable().default(null),
        marketSelection: z.unknown().nullable().default(null),
      }),
      execute: async ({ tradeExpression, marketSelection }) => {
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
                });
                await input.store.addTradeTicket(ticket);
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

async function latestPersistedTradeExpression(store: CassieStore, runId: string) {
  const latestStep = await latestSucceededStep(store, runId, "trade_expression");
  return latestStep
    ? TradeExpressionPlanSchema.parse(latestStep.output)
    : null;
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

function parseSuppliedTradeExpression(value: unknown) {
  const parsed = TradeExpressionPlanSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("Trade ticket creation requires a persisted or supplied trade expression.");
}

async function latestPersistedXSentiment(store: CassieStore, runId: string) {
  const latestStep = await latestSucceededStep(store, runId, "x_sentiment");
  return latestStep
    ? XSentimentAssessmentSchema.parse(latestStep.output)
    : undefined;
}

async function latestSucceededStep(
  store: CassieStore,
  runId: string,
  stepType: "market_candidates" | "market_selection" | "x_sentiment" | "trade_expression",
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
    assessment.candidateId === input.fitAssessment.candidateId
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
    warnings.push("No wallet address is configured; trade tickets may not be executable until wallet setup is complete.");
  }

  return PreflightUserPolicySchema.parse({
    status: "ok",
    warnings,
    policy: {
      defaultTradeSizeUsd: userSettings.defaultTradeSizeUsd,
      hasWalletAddress: Boolean(userSettings.walletAddress),
    },
  });
}
