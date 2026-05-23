import { z } from "zod";
import type { CassieStore } from "../core/db/store.ts";
import {
  MarketSelectionSchema,
  RiskDecisionSchema,
  SupervisorFinalResultSchema,
  TradeExpressionPlanSchema,
  TradeTicketSchema,
  type CassieActionState,
  type ControlRun,
  type MarketSelection,
  type RiskDecision,
  type RunStepType,
  type TradeExpressionPlan,
  type TradeTicket,
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

export function assertUsableMarketSelection(selection?: MarketSelection): void {
  if (!selection || !selection.selectedMarket || selection.noTradeReason) {
    throw new SupervisorPrerequisiteError("Risk check requires a usable market selection.");
  }
}

export function assertNonRejectedRiskDecision(decision?: RiskDecision): void {
  if (!decision || decision.decision === "reject") {
    throw new SupervisorPrerequisiteError("Trade ticket creation requires a non-rejected risk decision.");
  }
}

export function validateFinalizationPrerequisites(input: PreparedFinalizeRunInput) {
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
    runStatus: "awaiting_approval",
    ticketId: input.tradeTicket.ticketId,
    warnings: [],
  });
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
