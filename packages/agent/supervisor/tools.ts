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
  OpportunityFrameSchema,
  PolymarketMarketAssessmentSchema,
  PolymarketQuoteSchema,
  RiskDecisionSchema,
  SupervisorFinalResultSchema,
  TradeTicketSchema,
  TradeExpressionPlanSchema,
  type AccountState,
  type CassieActionState,
  type ControlRun,
  type MarketCandidate,
  type MarketSelection,
  type PolymarketMarketAssessment,
  type PolymarketQuote,
  type RiskDecision,
  type TradeTicket,
  type TradeExpressionPlan,
  type RunStepType,
  type UserSettings,
} from "../../core/schemas/index.ts";
import { assessPolymarketMarket, findPolymarketMarkets, quotePolymarketMarket, selectMarket } from "../tools/market.ts";
import type { MarketDataProvider, PolymarketMarketFinder } from "../tools/market.ts";
import { frameOpportunity, generateTradeExpressions } from "../tools/trade-expression.ts";
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
    frame_opportunity: tool({
      description: "Frame the market opportunity implied by the source post without choosing the final trade.",
      inputSchema: z.object({}),
      execute: async () => runStepOnce("opportunity", async () => {
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
      execute: async ({ opportunityFrame, marketCandidates }) => runStepOnce("trade_expression", async () => {
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
      }),
    }),
    search_venues: tool({
      description: "Search configured execution and market venues for real candidates matching the trade expression.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        venues: z.array(z.enum(["hyperliquid", "polymarket"])).optional(),
        limit: z.number().int().positive().max(25).optional(),
      }),
      execute: async ({ tradeExpression, venues, limit }) => runStepOnce("market_candidates", async () => {
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
      }),
    }),
    assess_expression_fit: tool({
      description: "Assess whether a real candidate expresses the intended trade, including prediction-market side semantics.",
      inputSchema: z.object({
        tradeExpression: TradeExpressionPlanSchema,
        candidate: MarketCandidateSchema,
        side: z.enum(["yes", "no"]).optional(),
      }),
      execute: async ({ tradeExpression, candidate, side }) => runStepOnce("market_assessment", async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_assessment",
          stepInput: { tradeExpression, candidate, side },
          execute: () => assessExpressionFit({
            polymarket: input.deps.polymarketMarketFinder,
            tradeExpression,
            candidate,
            side,
          }),
        });
      }),
    }),
    quote_expression: tool({
      description: "Refresh quote data for a promising real venue candidate.",
      inputSchema: z.object({
        candidate: MarketCandidateSchema,
        side: z.enum(["yes", "no"]).optional(),
      }),
      execute: async ({ candidate, side }) => runStepOnce("market_quote", async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_quote",
          stepInput: { candidate, side },
          execute: () => quoteExpression({
            polymarket: input.deps.polymarketMarketFinder,
            candidate,
            side,
          }),
        });
      }),
    }),
    rank_expressions: tool({
      description: "Rank real venue candidates and choose the best grounded trade expression; do not invent markets.",
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
            candidates: candidates ?? [],
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

async function searchVenues(input: {
  marketData: MarketDataProvider;
  polymarket?: PolymarketMarketFinder;
  thesis: ReturnType<typeof thesisFromTradeExpression>;
  tradeExpression: TradeExpressionPlan;
  venues?: Array<"hyperliquid" | "polymarket">;
  limit?: number;
}): Promise<MarketCandidate[]> {
  const venues = input.venues ?? [
    "hyperliquid",
    ...(input.polymarket ? ["polymarket" as const] : []),
  ];
  const candidateBatches: MarketCandidate[][] = [];

  if (venues.includes("hyperliquid")) {
    candidateBatches.push(await input.marketData.findCandidates({
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
    }));
  }

  if (venues.includes("polymarket")) {
    if (!input.polymarket) {
      throw new Error("search_venues requires a configured Polymarket market finder dependency.");
    }
    candidateBatches.push(await findPolymarketMarkets({
      polymarket: input.polymarket,
      thesis: input.thesis,
      tradeExpression: input.tradeExpression,
      limit: input.limit,
    }));
  }

  return uniqueMarketCandidates(candidateBatches.flat());
}

async function assessExpressionFit(input: {
  polymarket?: PolymarketMarketFinder;
  tradeExpression: TradeExpressionPlan;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): Promise<MarketCandidate | PolymarketMarketAssessment> {
  if (input.candidate.venue !== "polymarket") {
    return MarketCandidateSchema.parse(input.candidate);
  }
  if (!input.polymarket) {
    throw new Error("assess_expression_fit requires a configured Polymarket market finder dependency.");
  }
  const thesis = thesisFromTradeExpression(input.tradeExpression);
  return PolymarketMarketAssessmentSchema.parse(await assessPolymarketMarket({
    polymarket: input.polymarket,
    thesis,
    tradeExpression: input.tradeExpression,
    market: {
      conditionId: input.candidate.conditionId,
      marketSlug: input.candidate.marketSlug,
      question: input.candidate.marketQuestion,
    },
    side: input.side ?? polymarketSideFromCandidate(input.candidate),
  }));
}

async function quoteExpression(input: {
  polymarket?: PolymarketMarketFinder;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): Promise<MarketCandidate | PolymarketQuote> {
  if (input.candidate.venue !== "polymarket") {
    return MarketCandidateSchema.parse(input.candidate);
  }
  if (!input.polymarket) {
    throw new Error("quote_expression requires a configured Polymarket market finder dependency.");
  }
  if (!input.candidate.outcomeTokenId) {
    throw new Error("quote_expression requires a Polymarket outcome token id.");
  }
  return PolymarketQuoteSchema.parse(await quotePolymarketMarket({
    polymarket: input.polymarket,
    conditionId: input.candidate.conditionId,
    outcomeTokenId: input.candidate.outcomeTokenId,
    side: input.side ?? polymarketSideFromCandidate(input.candidate),
    yesPrice: input.candidate.yesPrice,
    noPrice: input.candidate.noPrice,
  }));
}

function polymarketSideFromCandidate(candidate: MarketCandidate): "yes" | "no" {
  if (candidate.outcome === "no" || candidate.side === "buy_no") return "no";
  return "yes";
}

function uniqueMarketCandidates(candidates: MarketCandidate[]): MarketCandidate[] {
  const seen = new Set<string>();
  return MarketCandidateSchema.array().parse(candidates).filter((candidate) => {
    const key = [
      candidate.venue,
      candidate.symbol,
      candidate.side,
      candidate.conditionId ?? "",
      candidate.outcomeTokenId ?? "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
