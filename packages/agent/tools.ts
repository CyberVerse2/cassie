import { tool } from "ai";
import { z } from "zod";
import type { CassieDependencies } from "./agent.ts";
import type { CassieStore } from "../core/db/store.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../adapters/hyperliquid/account-state.ts";
import { config } from "../core/config.ts";
import {
  MarketCandidateSchema,
  MarketSelectionSchema,
  OpportunityFrameSchema,
  ExpressionFitAssessmentSchema,
  RiskDecisionSchema,
  TradeTicketSchema,
  TradeExpressionPlanSchema,
  type AccountState,
  type ControlRun,
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
import { thesisFromTradeExpression } from "./thesis.ts";
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
      inputSchema: z.object({}),
      execute: async () => runStepOnce("opportunity", {}, async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "opportunity",
          promptName: "cassie_opportunity_frame",
          promptVersion,
          model: importantModel,
          stepInput: {
            userCommand: input.run.userCommand,
            sourcePost: input.run.sourcePost,
          },
          execute: () => frameOpportunity({
            ai: importantAi,
            sourcePost: input.run.sourcePost,
            userCommand: input.run.userCommand,
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
            execute: () => generateTradeExpressions({
              ai: importantAi,
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
        tradeExpression: TradeExpressionPlanSchema,
        candidate: MarketCandidateSchema,
        side: z.enum(["yes", "no"]).optional(),
      }),
      execute: async ({ tradeExpression, candidate, side }) => runStepOnce(
        "market_assessment",
        { tradeExpression, candidate, side },
        async () => {
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "market_assessment",
            promptName: "cassie_expression_fit",
            promptVersion,
            model: importantModel,
            stepInput: { tradeExpression, candidate, side },
            execute: () => assessExpressionFit({
              ai: importantAi,
              polymarket: input.deps.polymarketMarketFinder,
              tradeExpression,
              candidate,
              side,
            }),
          });
        },
      ),
    }),
    quote_expression: tool({
      description: "Refresh quote data for a validated candidate. Do not quote rejected or unassessed expressions.",
      inputSchema: z.object({
        candidate: MarketCandidateSchema,
        fitAssessment: ExpressionFitAssessmentSchema,
        side: z.enum(["yes", "no"]).optional(),
      }),
      execute: async ({ candidate, fitAssessment, side }) => runStepOnce(
        "market_quote",
        { candidate, fitAssessment, side },
        async () => {
          if (fitAssessment.fitStatus !== "validated") {
            throw new Error("quote_expression requires a validated fit assessment.");
          }
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "market_quote",
            stepInput: { candidate, fitAssessment, side },
            execute: () => quoteExpression({
              polymarket: input.deps.polymarketMarketFinder,
              candidate,
              side,
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
        quotes: z.array(z.unknown()).optional(),
      }),
      execute: async ({ tradeExpression, candidates, fitAssessments, quotes }) => runStepOnce(
        "market_selection",
        { tradeExpression, candidates, fitAssessments, quotes },
        async () => {
          const thesis = thesisFromTradeExpression(tradeExpression);
          return recordRunStep({
            store: input.store,
            runId: input.run.runId,
            stepType: "market_selection",
            promptName: "cassie_market_selection",
            promptVersion,
            model: cheapModel,
            stepInput: { tradeExpression, candidates, fitAssessments, quotes },
            execute: () => selectMarket({
              ai: cheapAi,
              marketData: input.deps.marketData,
              thesis,
              tradeExpression,
              candidates: candidates ?? [],
              fitAssessments,
              quotes,
            }),
          });
        },
      ),
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
          const thesis = thesisFromTradeExpression(tradeExpression);
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
