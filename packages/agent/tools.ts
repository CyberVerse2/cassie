import { tool } from "ai";
import { z } from "zod";
import type { CassieDependencies } from "./agent.ts";
import type { CassieStore } from "../core/db/store.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../adapters/hyperliquid/account-state.ts";
import { config } from "../core/config.ts";
import { withThinkingTraceCapture } from "../ai/client.ts";
import {
  MarketCandidateSchema,
  MarketSelectionSchema,
  OpportunityFrameSchema,
  ExpressionFitAssessmentSchema,
  SourcePostSchema,
  RiskDecisionSchema,
  TradeTicketSchema,
  TradeExpressionPlanSchema,
  XSentimentAssessmentSchema,
  type AccountState,
  type ControlRun,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type UserSettings,
} from "../core/schemas/index.ts";
import { selectMarket } from "../adapters/selection.ts";
import { evaluateRisk } from "../risk/index.ts";
import { createTradeTicket } from "../tickets/index.ts";
import { recordRunStep } from "./steps.ts";
import { prepareFinalInput } from "./public-summary.ts";
import { createRunStepCache } from "./tool-cache.ts";
import { frameOpportunity, generateTradeExpressions } from "./reasoning.ts";
import { assessExpressionFit, quoteExpression, searchVenues } from "./venues.ts";
import { thesisForMarketSelection, thesisFromTradeExpression } from "./thesis.ts";
import {
  FinalizeRunInputSchema,
  assertNonRejectedRiskDecision,
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

export function createCassieSupervisorTools(input: {
  store: CassieStore;
  deps: CassieDependencies;
  run: ControlRun;
  userSettings: UserSettings;
  accountState?: AccountState;
  accountStateProvider?: AccountStateProvider;
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
              polymarket: input.deps.polymarketMarketFinder,
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
      description: "Check X-only sentiment, novelty, crowding, and correction risk for a validated and quoted candidate.",
      inputSchema: z.object({
        sourcePost: SourcePostSchema.optional(),
        opportunityFrame: OpportunityFrameSchema,
        tradeExpression: TradeExpressionPlanSchema,
        fitAssessment: ExpressionFitAssessmentSchema,
        candidate: MarketCandidateSchema,
      }),
      execute: async ({ sourcePost, opportunityFrame, tradeExpression, fitAssessment, candidate }) => runStepOnce(
        "x_sentiment",
        { sourcePost, opportunityFrame, tradeExpression, fitAssessment, candidate },
        async () => {
          if (fitAssessment.fitStatus !== "validated") {
            throw new Error("check_x_sentiment requires a validated fit assessment.");
          }
          if (!input.deps.xSentimentProvider) {
            throw new Error("check_x_sentiment requires a configured X sentiment provider dependency.");
          }
          const source = sourcePost ?? input.run.sourcePost;
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "x_sentiment",
            promptName: "cassie_x_sentiment",
            promptVersion,
            model: config.ai.grokXSearchModel,
            stepInput: { sourcePost: source, opportunityFrame, tradeExpression, fitAssessment, candidate },
            execute: ({ setThinkingTrace }) => input.deps.xSentimentProvider!.checkXSentiment({
              sourcePost: source,
              opportunityFrame,
              tradeExpression,
              fitAssessment,
              candidate,
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
        candidates: MarketCandidateSchema.array().optional(),
        fitAssessments: ExpressionFitAssessmentSchema.array().optional(),
        quotes: z.array(z.unknown()).default([]),
        xSentiment: XSentimentAssessmentSchema.optional(),
      }),
      execute: async ({ tradeExpression, candidates, fitAssessments, quotes, xSentiment }) => {
        const persistedCandidates = candidates && candidates.length > 0
          ? candidates
          : await latestPersistedMarketCandidates(input.store, input.run.runId);
        const persistedFitAssessments = fitAssessments && fitAssessments.length > 0
          ? fitAssessments
          : await latestPersistedFitAssessments(input.store, input.run.runId);
        const persistedQuotes = await latestPersistedQuotes(input.store, input.run.runId);
        const persistedXSentiment = xSentiment
          ?? await latestPersistedXSentiment(input.store, input.run.runId);
        const groundedQuotes = persistedQuotes.length > 0 ? persistedQuotes : quotes;
        if (persistedCandidates.length > 0 && persistedFitAssessments.length < persistedCandidates.length) {
          throw new Error("rank_expressions requires fit assessments for every persisted venue candidate.");
        }
        const validatedFitAssessments = persistedFitAssessments.filter((assessment) => assessment.fitStatus === "validated");
        if (groundedQuotes.length === 0) {
          throw new Error("rank_expressions requires a persisted or supplied market quote.");
        }
        if (validatedFitAssessments.length > groundedQuotes.length) {
          throw new Error("rank_expressions requires quotes for every validated venue candidate.");
        }

        return runStepOnce(
          "market_selection",
          {
            tradeExpression,
            candidates: persistedCandidates,
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
              candidates: persistedCandidates,
              fitAssessments: persistedFitAssessments,
              quotes: groundedQuotes,
              xSentiment: persistedXSentiment,
            },
            execute: ({ setThinkingTrace }) => selectMarket({
              ai: withThinkingTraceCapture(cheapAi, setThinkingTrace),
              marketData: input.deps.marketData,
              thesis,
              tradeExpression,
              candidates: persistedCandidates,
              fitAssessments: persistedFitAssessments,
              quotes: groundedQuotes,
              xSentiment: persistedXSentiment,
            }),
          });
        },
        );
      },
    }),
    risk_check: tool({
      description: "Run deterministic risk checks against user policy and live account state.",
      inputSchema: z.object({
        marketSelection: MarketSelectionSchema,
        sizeUsd: z.number().positive().nullable().optional(),
      }),
      execute: async ({ marketSelection, sizeUsd }) => runStepOnce(
        "risk",
        { marketSelection, sizeUsd },
        async () => {
          assertUsableMarketSelection(marketSelection);
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "risk",
            stepInput: { marketSelection, sizeUsd },
            execute: async () => {
              const accountState = input.accountState ?? await (input.accountStateProvider ?? new HyperliquidAccountStateProvider())
                .getAccountState(input.userSettings);
              return evaluateRisk({
                marketSelection,
                userSettings: input.userSettings,
                accountState,
                sizeUsd,
              });
            },
          });
        },
      ),
    }),
    create_trade_ticket: tool({
      description: "Create a trade ticket from a non-rejected risk decision. This never executes the order.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        marketSelection: MarketSelectionSchema,
        riskDecision: RiskDecisionSchema,
        sizeUsd: z.number().positive().nullable().optional(),
      }),
      execute: async ({ tradeExpression, marketSelection, riskDecision, sizeUsd }) => runStepOnce(
        "ticket",
        { tradeExpression, marketSelection, riskDecision, sizeUsd },
        async () => {
          assertUsableMarketSelection(marketSelection);
          assertNonRejectedRiskDecision(riskDecision);
          const thesis = thesisForMarketSelection(tradeExpression, marketSelection);
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "ticket",
            stepInput: { tradeExpression, marketSelection, riskDecision, sizeUsd },
            execute: async () => {
              const ticket = createTradeTicket({
                runId: input.run.runId,
                userSettings: input.userSettings,
                thesis,
                marketSelection,
                riskDecision,
                sizeUsd,
              });
              await input.store.addTradeTicket(ticket);
              return ticket;
            },
          });
        },
      ),
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
              status: preparedFinalInput.responseType === "trade_ticket" ? "awaiting_approval" as const : "succeeded" as const,
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
    ? MarketCandidateSchema.array().safeParse(latestStep.output).data ?? []
    : [];
}

async function latestPersistedFitAssessments(store: CassieStore, runId: string): Promise<ExpressionFitAssessment[]> {
  const steps = await store.getRunSteps(runId);
  return steps
    .filter((step) => step.stepType === "market_assessment" && step.status === "succeeded")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((step) => ExpressionFitAssessmentSchema.safeParse(step.output).data)
    .filter((assessment): assessment is ExpressionFitAssessment => Boolean(assessment));
}

async function latestPersistedQuotes(store: CassieStore, runId: string): Promise<unknown[]> {
  const steps = await store.getRunSteps(runId);
  return steps
    .filter((step) => step.stepType === "market_quote" && step.status === "succeeded")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((step) => step.output)
    .filter((quote) => quote !== null && quote !== undefined);
}

async function latestPersistedXSentiment(store: CassieStore, runId: string) {
  const latestStep = await latestSucceededStep(store, runId, "x_sentiment");
  return latestStep
    ? XSentimentAssessmentSchema.safeParse(latestStep.output).data
    : undefined;
}

async function latestSucceededStep(
  store: CassieStore,
  runId: string,
  stepType: "market_candidates" | "x_sentiment",
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
  const steps = await input.store.getRunSteps(input.runId);
  const latestStep = steps
    .filter((step) => step.stepType === "market_assessment" && step.status === "succeeded")
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const assessment = latestStep
    ? ExpressionFitAssessmentSchema.safeParse(latestStep.output).data
    : null;
  const match = assessment
    && assessment.candidateId === input.fitAssessment.candidateId
    && assessment.expressionId === input.fitAssessment.expressionId
    && assessment.venue === input.fitAssessment.venue
    && assessment.fitStatus === input.fitAssessment.fitStatus;

  if (match) return assessment;
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
