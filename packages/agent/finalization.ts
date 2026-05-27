import { z } from "zod";
import type { CassieStore } from "../core/db/store.ts";
import {
  ExpressionFitAssessmentSchema,
  MarketCandidateSchema,
  MarketSelectionSchema,
  RiskDecisionSchema,
  SupervisorFinalResultSchema,
  TradeExpressionPlanSchema,
  TradeTicketSchema,
  XSentimentAssessmentSchema,
  type CassieActionState,
  type ControlRun,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type MarketSelection,
  type RiskDecision,
  type RunStep,
  type RunStepType,
  type TradeExpressionPlan,
  type TradeTicket,
  type XSentimentAssessment,
} from "../core/schemas/index.ts";
import { prepareFinalInput } from "./public-summary.ts";
import { recordRunStep } from "./steps.ts";
import { isInsufficientEvidence } from "./thesis.ts";

export const FinalizeRunInputSchema = z.object({
  responseType: z.enum(["analysis", "trade_ticket"]),
  publicSummary: z.string(),
  tradeTicket: z.object({ ticketId: z.string() }).optional(),
  marketSelection: MarketSelectionSchema.optional(),
  tradeExpression: TradeExpressionPlanSchema.optional(),
  riskDecision: RiskDecisionSchema.optional(),
});

export type FinalizeRunInput = z.infer<typeof FinalizeRunInputSchema>;
export type PreparedFinalizeRunInput = FinalizeRunInput;

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
  const steps = await input.store.getRunSteps(input.run.runId);
  const tradeExpression = readPersistedStepOutput<TradeExpressionPlan>(steps, "trade_expression", TradeExpressionPlanSchema);
  const marketCandidates = readPersistedStepOutput<MarketCandidate[]>(steps, "market_candidates", MarketCandidateSchema.array());
  const expressionFit = readPersistedStepOutput<ExpressionFitAssessment>(steps, "market_assessment", ExpressionFitAssessmentSchema);
  const quote = latestPersistedStepOutput(steps, "market_quote");
  const xSentiment = readPersistedStepOutput<XSentimentAssessment>(steps, "x_sentiment", XSentimentAssessmentSchema);
  const marketSelection = readPersistedStepOutput<MarketSelection>(steps, "market_selection", MarketSelectionSchema)
    ?? noTradeSelectionFromCompletedMarketCheck(marketCandidates, expressionFit);
  const riskDecision = readPersistedStepOutput<RiskDecision>(steps, "risk", RiskDecisionSchema);
  const tradeTicket = readPersistedStepOutput<TradeTicket>(steps, "ticket", TradeTicketSchema);

  validatePersistedStageProgress({
    tradeExpression,
    marketCandidates,
    expressionFit,
    quote,
    xSentiment,
    marketSelection,
    riskDecision,
    tradeTicket,
  });

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
        status: "succeeded" as const,
        result,
        error: null,
        updatedAt: new Date().toISOString(),
      });
      return result;
    },
  });
}

function validatePersistedStageProgress(input: {
  tradeExpression?: TradeExpressionPlan;
  marketCandidates?: MarketCandidate[];
  expressionFit?: ExpressionFitAssessment;
  quote?: unknown;
  xSentiment?: XSentimentAssessment;
  marketSelection?: MarketSelection;
  riskDecision?: RiskDecision;
  tradeTicket?: TradeTicket;
}) {
  if (!input.tradeExpression || input.tradeExpression.decision === "no_trade") {
    return;
  }

  if (input.tradeExpression.decision !== "needs_market_check" && input.tradeExpression.decision !== "route_to_market_router") {
    return;
  }

  if (!input.marketCandidates) {
    throw new SupervisorPrerequisiteError("Market-check finalization requires a completed venue search.");
  }

  if (input.marketCandidates.length === 0) {
    return;
  }

  if (!input.expressionFit) {
    throw new SupervisorPrerequisiteError("Market-check finalization requires expression-fit assessment.");
  }

  if (input.expressionFit.fitStatus !== "validated") {
    return;
  }

  if (!input.quote) {
    throw new SupervisorPrerequisiteError("Validated expression finalization requires a quote.");
  }

  if (!input.xSentiment) {
    throw new SupervisorPrerequisiteError("Quoted expression finalization requires X sentiment check.");
  }

  if (!input.marketSelection) {
    throw new SupervisorPrerequisiteError("Quoted expression finalization requires expression ranking.");
  }

  if (!input.marketSelection.selectedMarket || input.marketSelection.noTradeReason) {
    return;
  }

  if (!input.riskDecision) {
    throw new SupervisorPrerequisiteError("Selected expression finalization requires a deterministic risk check.");
  }

  if (input.riskDecision.decision === "reject") {
    return;
  }

  if (!input.tradeTicket) {
    throw new SupervisorPrerequisiteError("Approved expression finalization requires trade ticket creation.");
  }
}

function noTradeSelectionFromCompletedMarketCheck(
  marketCandidates?: MarketCandidate[],
  expressionFit?: ExpressionFitAssessment,
): MarketSelection | undefined {
  if (marketCandidates && marketCandidates.length === 0) {
    return {
      decision: "no_selection",
      selectedMarket: null,
      selectedCandidateId: null,
      rejectionReason: "No configured venue candidates matched the trade expression.",
      rankedCandidates: [],
      rejectedCandidates: [],
      noTradeReason: "No configured venue candidates matched the trade expression.",
    };
  }

  if (expressionFit && expressionFit.fitStatus !== "validated") {
    return {
      decision: "no_selection",
      selectedMarket: null,
      selectedCandidateId: expressionFit.candidateId,
      rejectionReason: expressionFit.semanticFitSummary,
      rankedCandidates: [],
      rejectedCandidates: [
        {
          venue: expressionFit.venue,
          symbol: expressionFit.candidateId,
          reason: expressionFit.semanticFitSummary,
        },
      ],
      noTradeReason: expressionFit.semanticFitSummary,
    };
  }

  return undefined;
}

export function assertUsableMarketSelection(selection?: MarketSelection): void {
  if (!selection || !selection.selectedMarket || selection.noTradeReason) {
    throw new SupervisorPrerequisiteError("Risk check requires a usable market selection.");
  }
}

export function assertApprovedRiskDecision(decision?: RiskDecision): void {
  if (!decision || decision.decision !== "approve") {
    throw new SupervisorPrerequisiteError("Trade ticket creation requires an approved risk decision.");
  }
}

export function validateFinalizationPrerequisites(input: PreparedFinalizeRunInput) {
  if (input.responseType === "trade_ticket") {
    if (!input.tradeTicket) {
      throw new SupervisorPrerequisiteError("Trade-ticket finalization requires a trade ticket.");
    }
    if (!input.riskDecision) {
      throw new SupervisorPrerequisiteError("Trade-ticket finalization requires an approved risk decision.");
    }
    assertApprovedRiskDecision(input.riskDecision);
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

export function finalizeResult(input: PreparedFinalizeRunInput) {
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
    runStatus: "succeeded",
    ticketId: input.tradeTicket.ticketId,
    warnings: [],
  });
}

function readPersistedStepOutput<T>(
  steps: RunStep[],
  stepType: RunStepType,
  schema: z.ZodType<T>,
): T | undefined {
  const persisted = latestPersistedStepOutput(steps, stepType);
  return persisted == null ? undefined : schema.parse(persisted);
}

function latestPersistedStepOutput(steps: RunStep[], stepType: RunStepType): unknown {
  return steps
    .filter((step) => step.stepType === stepType && step.status === "succeeded" && step.output != null)
    .at(-1)?.output;
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
