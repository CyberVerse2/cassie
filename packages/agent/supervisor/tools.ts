import { tool } from "ai";
import { z } from "zod";
import type { CassieDependencies } from "../../app/dependencies.ts";
import type { CassieStore } from "../../core/db/store.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../../execution/account-state.ts";
import { config } from "../../core/config.ts";
import {
  MarketCandidateSchema,
  MarketSelectionSchema,
  RiskDecisionSchema,
  SupervisorFinalResultSchema,
  TradeTicketSchema,
  TradeExpressionPlanSchema,
  type AccountState,
  type CassieActionState,
  type ControlRun,
  type MarketSelection,
  type RiskDecision,
  type TradeTicket,
  type TradeExpressionPlan,
  type RunStepType,
  type UserSettings,
} from "../../core/schemas/index.ts";
import { assessPolymarketMarket, findPolymarketMarkets, quotePolymarketMarket, selectMarket } from "../tools/market.ts";
import { planTradeExpression } from "../tools/trade-expression.ts";
import { evaluateRisk } from "../../risk/index.ts";
import { createTradeTicket } from "../tools/trade.ts";
import { recordRunStep } from "./steps.ts";
import { prepareFinalInput } from "./public-summary.ts";

const promptVersion = "2026-05-20";

const FinalizeRunInputSchema = z.object({
  responseType: z.enum(["analysis", "trade_ticket"]),
  publicSummary: z.string(),
  tradeTicket: z.object({ ticketId: z.string() }).optional(),
  marketSelection: MarketSelectionSchema.optional(),
  tradeExpression: TradeExpressionPlanSchema.optional(),
  riskDecision: RiskDecisionSchema.optional(),
});

type FinalizeRunInput = z.infer<typeof FinalizeRunInputSchema>;
type PreparedFinalizeRunInput = FinalizeRunInput;

export class SupervisorPrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorPrerequisiteError";
  }
}

export async function finalizeRunFromPersistedSteps(input: {
  store: CassieStore;
  run: ControlRun;
}) {
  const [tradeExpression, marketSelection, riskDecision, tradeTicket] = await Promise.all([
    readPersistedStepOutput<TradeExpressionPlan>(input.store, input.run.runId, "trade_expression", TradeExpressionPlanSchema),
    readPersistedStepOutput<MarketSelection>(input.store, input.run.runId, "market_selection", MarketSelectionSchema),
    readPersistedStepOutput<RiskDecision>(input.store, input.run.runId, "risk", RiskDecisionSchema),
    readPersistedStepOutput<TradeTicket>(input.store, input.run.runId, "ticket", TradeTicketSchema),
  ]);

  const finalInput: PreparedFinalizeRunInput = {
    responseType: tradeTicket ? "trade_ticket" : "analysis",
    publicSummary: riskDecision?.decision === "reject"
      ? riskDecision.reason
      : tradeExpression?.reason ?? "Cassie run completed.",
    tradeExpression,
    marketSelection,
    riskDecision,
    tradeTicket: tradeTicket ? { ticketId: tradeTicket.ticketId } : undefined,
  };
  const preparedFinalInput = prepareFinalInput(finalInput);

  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "final",
    stepInput: preparedFinalInput,
    execute: async () => {
      validateFinalizationPrerequisites(preparedFinalInput);
      const result = finalizeResult(preparedFinalInput);
      await input.store.updateRun({
        ...input.run,
        status: preparedFinalInput.responseType === "trade_ticket" ? "awaiting_approval" as const : "succeeded" as const,
        result,
        error: null,
        updatedAt: new Date().toISOString(),
      });
      return result;
    },
  });
}

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
  const stepOutputs = new Map<RunStepType, Promise<unknown>>();
  const runStepOnce = <T>(stepType: RunStepType, execute: () => Promise<T>): Promise<T> => {
    const existing = stepOutputs.get(stepType);
    if (existing) return existing as Promise<T>;

    const promise = execute().catch((error) => {
      stepOutputs.delete(stepType);
      throw error;
    });
    stepOutputs.set(stepType, promise);
    return promise;
  };

  return {
    plan_trade_expression: tool({
      description: "Translate the user's command and source post into the cleanest venue-aware trade expression.",
      inputSchema: z.object({}),
      execute: async () => runStepOnce("trade_expression", async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "trade_expression",
          promptName: "cassie_trade_expression",
          promptVersion,
          model: importantModel,
          stepInput: {
            userCommand: input.run.userCommand,
            sourcePost: input.run.sourcePost,
          },
          execute: () => planTradeExpression({
            ai: importantAi,
            marketData: input.deps.marketData,
            polymarketMarketFinder: input.deps.polymarketMarketFinder,
            sourcePost: input.run.sourcePost,
            userCommand: input.run.userCommand,
          }),
        });
      }),
    }),
    find_polymarket_markets: tool({
      description: "Use AI-planned semantic search to find real Polymarket markets related to the trade expression.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        limit: z.number().int().positive().max(25).optional(),
      }),
      execute: async ({ tradeExpression, limit }) => runStepOnce("market_candidates", async () => {
        const polymarket = input.deps.polymarketMarketFinder;
        if (!polymarket) {
          throw new Error("Cassie supervisor requires a Polymarket market finder dependency.");
        }
        const thesis = thesisFromTradeExpression(tradeExpression);
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_candidates",
          stepInput: { tradeExpression, limit },
          execute: () => findPolymarketMarkets({
            polymarket,
            thesis,
            tradeExpression,
            limit,
          }),
        });
      }),
    }),
    assess_polymarket_market: tool({
      description: "Assess whether a discovered Polymarket contract directly expresses the trade expression and normalize its YES/NO trade object.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        conditionId: z.string().optional(),
        marketSlug: z.string().optional(),
        question: z.string().optional(),
        side: z.enum(["yes", "no"]),
      }),
      execute: async ({ tradeExpression, conditionId, marketSlug, question, side }) => runStepOnce("market_assessment", async () => {
        const polymarket = input.deps.polymarketMarketFinder;
        if (!polymarket) {
          throw new Error("Cassie supervisor requires a Polymarket market finder dependency.");
        }
        const thesis = thesisFromTradeExpression(tradeExpression);
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_assessment",
          stepInput: { tradeExpression, market: { conditionId, marketSlug, question }, side },
          execute: () => assessPolymarketMarket({
            polymarket,
            thesis,
            tradeExpression,
            market: { conditionId, marketSlug, question },
            side,
          }),
        });
      }),
    }),
    quote_polymarket_market: tool({
      description: "Refresh a Polymarket outcome-token quote and return YES, NO, and held-side price semantics.",
      inputSchema: z.object({
        conditionId: z.string().optional(),
        outcomeTokenId: z.string(),
        side: z.enum(["yes", "no"]),
        yesPrice: z.number().positive().max(1).optional(),
        noPrice: z.number().positive().max(1).optional(),
      }),
      execute: async ({ conditionId, outcomeTokenId, side, yesPrice, noPrice }) => runStepOnce("market_quote", async () => {
        const polymarket = input.deps.polymarketMarketFinder;
        if (!polymarket) {
          throw new Error("Cassie supervisor requires a Polymarket market finder dependency.");
        }
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_quote",
          stepInput: { conditionId, outcomeTokenId, side, yesPrice, noPrice },
          execute: () => quotePolymarketMarket({
            polymarket,
            conditionId,
            outcomeTokenId,
            side,
            yesPrice,
            noPrice,
          }),
        });
      }),
    }),
    select_market: tool({
      description: "Select the best market expression from real market candidates; do not invent markets.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        candidates: MarketCandidateSchema.array().optional(),
      }),
      execute: async ({ tradeExpression, candidates }) => runStepOnce("market_selection", async () => {
        const thesis = thesisFromTradeExpression(tradeExpression);
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_selection",
          promptName: "cassie_market_selection",
          promptVersion,
          model: cheapModel,
          stepInput: { tradeExpression, candidates },
          execute: () => selectMarket({
            ai: cheapAi,
            marketData: input.deps.marketData,
            thesis,
            tradeExpression,
            candidates,
          }),
        });
      }),
    }),
    risk_check: tool({
      description: "Run deterministic risk checks against user policy and live account state.",
      inputSchema: z.object({
        marketSelection: MarketSelectionSchema,
        sizeUsd: z.number().positive().nullable().optional(),
      }),
      execute: async ({ marketSelection, sizeUsd }) => runStepOnce("risk", async () => {
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
      }),
    }),
    create_trade_ticket: tool({
      description: "Create a trade ticket from a non-rejected risk decision. This never executes the order.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        marketSelection: MarketSelectionSchema,
        riskDecision: RiskDecisionSchema,
        sizeUsd: z.number().positive().nullable().optional(),
      }),
      execute: async ({ tradeExpression, marketSelection, riskDecision, sizeUsd }) => runStepOnce("ticket", async () => {
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
      }),
    }),
    finalize_run: tool({
      description: "Finalize the Cassie run with the user-facing result after analysis, critique, or trade-ticket creation.",
      inputSchema: FinalizeRunInputSchema,
      execute: async (finalInput) => runStepOnce("final", async () => {
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

async function readPersistedStepOutput<T>(
  store: CassieStore,
  runId: string,
  stepType: RunStepType,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const steps = await store.getRunSteps(runId);
  const persisted = steps
    .filter((step) => step.stepType === stepType && step.status === "succeeded" && step.output != null)
    .at(-1)?.output;
  return persisted == null ? undefined : schema.parse(persisted);
}

function assertUsableMarketSelection(selection?: MarketSelection): void {
  if (!selection || !selection.selectedMarket || selection.noTradeReason) {
    throw new SupervisorPrerequisiteError("Risk check requires a usable market selection.");
  }
}

function assertNonRejectedRiskDecision(decision?: RiskDecision): void {
  if (!decision || decision.decision === "reject") {
    throw new SupervisorPrerequisiteError("Trade ticket creation requires a non-rejected risk decision.");
  }
}

function validateFinalizationPrerequisites(input: PreparedFinalizeRunInput) {
  if (input.responseType === "trade_ticket") {
    if (!input.tradeTicket) {
      throw new SupervisorPrerequisiteError("Trade-ticket finalization requires a trade ticket.");
    }
    if (!input.riskDecision) {
      throw new SupervisorPrerequisiteError("Trade-ticket finalization requires a non-rejected risk decision.");
    }
    assertNonRejectedRiskDecision(input.riskDecision);
    return;
  }

  const hasMeaningfulAnalysisBasis = Boolean(
    input.tradeExpression ||
      input.marketSelection ||
      input.riskDecision ||
      input.tradeTicket,
  );
  if (!hasMeaningfulAnalysisBasis) {
    throw new SupervisorPrerequisiteError("finalize_run analysis response requires analysis.");
  }
}

function finalizeResult(input: PreparedFinalizeRunInput) {
  const actionState = resolveActionState(input);

  if (input.responseType === "analysis") {
    return SupervisorFinalResultSchema.parse({
      responseType: input.responseType,
      actionState,
      publicSummary: input.publicSummary,
      runStatus: "succeeded",
      ticketId: null,
      warnings: [],
    });
  }
  if (!input.tradeTicket) {
    throw new Error("finalize_run trade_ticket response requires tradeTicket.");
  }
  return SupervisorFinalResultSchema.parse({
    responseType: input.responseType,
    actionState,
    publicSummary: input.publicSummary,
    runStatus: "awaiting_approval",
    ticketId: input.tradeTicket.ticketId,
    warnings: [],
  });
}

function resolveActionState(input: PreparedFinalizeRunInput): CassieActionState {
  if (input.responseType === "trade_ticket") return "create_ticket";
  if (input.riskDecision?.decision === "reject") return "block_trade";

  const selectedSide = input.marketSelection?.selectedMarket?.side;
  if (selectedSide === "long") return "long_perp";
  if (selectedSide === "short") return "short_perp";
  if (selectedSide === "buy_yes") return "buy_yes";
  if (selectedSide === "buy_no") return "buy_no";

  if (input.marketSelection?.noTradeReason) return "no_trade";

  const tradeExpression = input.tradeExpression;
  if (isInsufficientEvidence(tradeExpression)) return "insufficient_evidence";
  if (tradeExpression?.decision === "route_to_market_router") return "route_to_market";
  if (tradeExpression?.decision === "needs_market_check") return "needs_market_check";
  if (tradeExpression?.decision === "no_trade") return "no_trade";

  return "insufficient_evidence";
}

function thesisFromTradeExpression(tradeExpression: TradeExpressionPlan) {
  return {
    claim: tradeExpression.coreInterpretation || tradeExpression.signal,
    literalClaim: tradeExpression.signal,
    impliedResearchQuestion: null,
    impliedTradeThesis: tradeExpression.highestPurityExpression,
    sourceOrMetaSignal: null,
    hasExplicitTrade: true,
    hasConcreteResearchQuestion: false,
    hasTradableImplication: tradeExpression.decision !== "no_trade",
    thesisStrength: "explicit" as const,
    shouldNotInferTradeBecause: [],
    direction: directionFromTradeExpression(tradeExpression),
    mentionedAssets: tradeExpression.directAsset ? [tradeExpression.directAsset] : [],
    topics: [],
    timeHorizon: "unclear" as const,
    evidenceQuality: "unknown" as const,
    manipulationRisk: "unknown" as const,
    confidence: tradeExpression.tradeExpressionConfidence ?? 0.5,
  };
}

function directionFromTradeExpression(tradeExpression: TradeExpressionPlan) {
  const expression = tradeExpression.highestPurityExpression.toLowerCase();
  if (expression.includes("short") || expression.includes("buy no")) return "bearish" as const;
  if (expression.includes("long") || expression.includes("buy yes")) return "bullish" as const;
  return "unclear" as const;
}

function isInsufficientEvidence(tradeExpression?: TradeExpressionPlan): boolean {
  if (!tradeExpression) return true;
  if (tradeExpression.insufficiency && tradeExpression.insufficiency.score < tradeExpression.insufficiency.requiredThreshold) {
    return true;
  }
  return typeof tradeExpression.tradeExpressionConfidence === "number" && tradeExpression.tradeExpressionConfidence < 0.65;
}
