import { tool } from "ai";
import { z } from "zod";
import type { CassieDependencies } from "../../app/dependencies.ts";
import type { CassieStore } from "../../db/store.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../../execution/account-state.ts";
import { config } from "../../core/config.ts";
import {
  CritiqueSchema,
  IntentResultSchema,
  MarketCandidateSchema,
  MarketSelectionSchema,
  ResearchReportSchema,
  RiskDecisionSchema,
  SignalInterpretationSchema,
  SupervisorFinalResultSchema,
  ThesisSchema,
  TradeTicketSchema,
  TradeExpressionPlanSchema,
  type AccountState,
  type CassieActionState,
  type ControlRun,
  type Critique,
  type IntentResult,
  type MarketSelection,
  type ResearchReport,
  type RiskDecision,
  type Thesis,
  type TradeTicket,
  type TradeExpressionPlan,
  type RunStepType,
  type UserSettings,
} from "../../core/schemas/index.ts";
import { routeIntent } from "../tools/intent-router.ts";
import { interpretSignal } from "../tools/signal.ts";
import { critiqueThesis } from "../tools/critique.ts";
import { assessPolymarketMarket, findPolymarketMarkets, quotePolymarketMarket, selectMarket } from "../tools/market.ts";
import { planTradeExpression } from "../tools/trade-expression.ts";
import { researchThesis } from "../../research/index.ts";
import { evaluateRisk } from "../../risk/index.ts";
import { extractInverseThesis, extractThesis } from "../tools/thesis.ts";
import { createTradeTicket } from "../tools/trade.ts";
import { recordRunStep } from "./steps.ts";

const promptVersion = "2026-05-20";

const FinalizeRunInputSchema = z.object({
  responseType: z.enum(["analysis", "critique", "trade_ticket"]),
  publicSummary: z.string(),
  tradeTicket: z.object({ ticketId: z.string() }).optional(),
  intent: IntentResultSchema.optional(),
  thesis: ThesisSchema.optional(),
  marketSelection: MarketSelectionSchema.optional(),
  critique: CritiqueSchema.optional(),
  researchReport: ResearchReportSchema.optional(),
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
  const [intent, thesis, researchReport, critique, tradeExpression, marketSelection, riskDecision, tradeTicket] = await Promise.all([
    readPersistedStepOutput<IntentResult>(input.store, input.run.runId, "intent", IntentResultSchema),
    readPersistedStepOutput<Thesis>(input.store, input.run.runId, "thesis", ThesisSchema),
    readPersistedStepOutput<ResearchReport>(input.store, input.run.runId, "research", ResearchReportSchema),
    readPersistedStepOutput<Critique>(input.store, input.run.runId, "critique", CritiqueSchema),
    readPersistedStepOutput<TradeExpressionPlan>(input.store, input.run.runId, "trade_expression", TradeExpressionPlanSchema),
    readPersistedStepOutput<MarketSelection>(input.store, input.run.runId, "market_selection", MarketSelectionSchema),
    readPersistedStepOutput<RiskDecision>(input.store, input.run.runId, "risk", RiskDecisionSchema),
    readPersistedStepOutput<TradeTicket>(input.store, input.run.runId, "ticket", TradeTicketSchema),
  ]);

  const finalInput: PreparedFinalizeRunInput = {
    responseType: tradeTicket ? "trade_ticket" : critique ? "critique" : "analysis",
    publicSummary: riskDecision?.decision === "reject"
      ? riskDecision.reason
      : critique?.finalCritique ?? tradeExpression?.reason ?? researchReport?.publicSummary ?? "Cassie run completed.",
    intent,
    thesis,
    researchReport,
    critique,
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
    classify_intent: tool({
      description: "Classify the user's Cassie command into critic, trade, countertrade, or watch.",
      inputSchema: z.object({}),
      execute: async () => runStepOnce("intent", () => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "intent",
        promptName: "cassie_intent",
        promptVersion,
        model: cheapModel,
        stepInput: { userCommand: input.run.userCommand, sourcePost: input.run.sourcePost },
        execute: () => routeIntent({
          ai: cheapAi,
          userCommand: input.run.userCommand,
          sourcePost: input.run.sourcePost,
        }),
      })),
    }),
    extract_thesis: tool({
      description: "Extract the market thesis from the source post and command.",
      inputSchema: z.object({
        signal: SignalInterpretationSchema,
      }),
      execute: async ({ signal }) => runStepOnce("thesis", async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "thesis",
          promptName: "cassie_thesis",
          promptVersion,
          model: cheapModel,
          stepInput: { userCommand: input.run.userCommand, sourcePost: input.run.sourcePost, signal },
          execute: () => extractThesis({
            ai: cheapAi,
            userCommand: input.run.userCommand,
            sourcePost: input.run.sourcePost,
            signal,
          }),
        });
      }),
    }),
    interpret_signal: tool({
      description: "Classify the source post into signal type, lead quality, tradability, and research angles.",
      inputSchema: z.object({}),
      execute: async () => runStepOnce("signal", () => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "signal",
        promptName: "cassie_signal",
        promptVersion,
        model: cheapModel,
        stepInput: { userCommand: input.run.userCommand, sourcePost: input.run.sourcePost },
        execute: () => interpretSignal({
          ai: cheapAi,
          userCommand: input.run.userCommand,
          sourcePost: input.run.sourcePost,
        }),
      })),
    }),
    extract_inverse_thesis: tool({
      description: "Create the strongest opposing thesis for a countertrade or fade request.",
      inputSchema: z.object({
        intent: IntentResultSchema,
        thesis: ThesisSchema,
      }),
      execute: async ({ intent, thesis }) => runStepOnce("inverse_thesis", async () => {
        if (intent.intent !== "countertrade") {
          throw new SupervisorPrerequisiteError("extract_inverse_thesis is only for countertrade or fade requests. If this is not countertrade, continue with research, trade expression planning, or finalization.");
        }
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "inverse_thesis",
          promptName: "cassie_inverse_thesis",
          promptVersion,
          model: cheapModel,
          stepInput: { thesis },
          execute: () => extractInverseThesis({ ai: cheapAi, thesis }),
        });
      }),
    }),
    research_thesis: tool({
      description: "Run Cassie's research subagent. It verifies evidence but never chooses markets or executes orders.",
      inputSchema: z.object({
        signal: SignalInterpretationSchema,
        thesis: ThesisSchema,
        researchAngle: z.enum(["balanced", "critic", "counter"]),
      }),
      execute: async ({ signal, thesis, researchAngle }) => runStepOnce("research", async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "research",
          promptName: "cassie_research_report",
          promptVersion,
          model: importantModel,
          stepInput: { signal, thesis, researchAngle },
          execute: async () => {
            const report = await researchThesis({
              ai: importantAi,
              sourceProfileAi: importantAi,
              lanes: input.deps.researchLanes,
              sourcePost: input.run.sourcePost,
              userCommand: input.run.userCommand,
              signal,
              thesis,
              researchAngle,
              persistence: {
                store: input.store,
                controlRunId: input.run.runId,
              },
            });
            await input.store.addResearchReport({
              runId: input.run.runId,
              report,
            });
            return report;
          },
        });
      }),
    }),
    critique_thesis: tool({
      description: "Critique a researched thesis and identify weaknesses without creating a trade.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema,
      }),
      execute: async ({ thesis, researchReport }) => runStepOnce("critique", async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "critique",
          promptName: "cassie_critique",
          promptVersion,
          model: importantModel,
          stepInput: { thesis, researchReport },
          execute: () => critiqueThesis({ ai: importantAi, thesis, researchReport }),
        });
      }),
    }),
    plan_trade_expression: tool({
      description: "Decide whether the researched thesis has a clean venue-aware trade expression.",
      inputSchema: z.object({
        signal: SignalInterpretationSchema,
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema,
      }),
      execute: async ({ signal, thesis, researchReport }) => runStepOnce("trade_expression", async () => {
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
            signal,
            thesis,
            researchReport,
          },
          execute: () => planTradeExpression({
            ai: importantAi,
            marketData: input.deps.marketData,
            polymarketMarketFinder: input.deps.polymarketMarketFinder,
            sourcePost: input.run.sourcePost,
            userCommand: input.run.userCommand,
            signal,
            thesis,
            researchReport,
          }),
        });
      }),
    }),
    find_polymarket_markets: tool({
      description: "Use AI-planned semantic search to find real Polymarket markets related to the researched thesis and trade expression.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema,
        tradeExpression: TradeExpressionPlanSchema,
        limit: z.number().int().positive().max(25).optional(),
      }),
      execute: async ({ thesis, researchReport, tradeExpression, limit }) => runStepOnce("market_candidates", async () => {
        const polymarket = input.deps.polymarketMarketFinder;
        if (!polymarket) {
          throw new Error("Cassie supervisor requires a Polymarket market finder dependency.");
        }
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_candidates",
          stepInput: { thesis, researchReport, tradeExpression, limit },
          execute: () => findPolymarketMarkets({
            polymarket,
            thesis,
            researchReport,
            tradeExpression,
            limit,
          }),
        });
      }),
    }),
    assess_polymarket_market: tool({
      description: "Assess whether a discovered Polymarket contract directly expresses the thesis and normalize its YES/NO trade object.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema,
        tradeExpression: TradeExpressionPlanSchema,
        conditionId: z.string().optional(),
        marketSlug: z.string().optional(),
        question: z.string().optional(),
        side: z.enum(["yes", "no"]),
      }),
      execute: async ({ thesis, researchReport, tradeExpression, conditionId, marketSlug, question, side }) => runStepOnce("market_assessment", async () => {
        const polymarket = input.deps.polymarketMarketFinder;
        if (!polymarket) {
          throw new Error("Cassie supervisor requires a Polymarket market finder dependency.");
        }
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_assessment",
          stepInput: { thesis, researchReport, tradeExpression, market: { conditionId, marketSlug, question }, side },
          execute: () => assessPolymarketMarket({
            polymarket,
            thesis,
            researchReport,
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
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema,
        tradeExpression: TradeExpressionPlanSchema,
        candidates: MarketCandidateSchema.array().optional(),
      }),
      execute: async ({ thesis, researchReport, tradeExpression, candidates }) => runStepOnce("market_selection", async () => {
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_selection",
          promptName: "cassie_market_selection",
          promptVersion,
          model: cheapModel,
          stepInput: { thesis, researchReport, tradeExpression, candidates },
          execute: () => selectMarket({
            ai: cheapAi,
            marketData: input.deps.marketData,
            thesis,
            researchReport,
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
        intent: IntentResultSchema,
        thesis: ThesisSchema,
        marketSelection: MarketSelectionSchema,
        riskDecision: RiskDecisionSchema,
        sizeUsd: z.number().positive().nullable().optional(),
      }),
      execute: async ({ intent, thesis, marketSelection, riskDecision, sizeUsd }) => runStepOnce("ticket", async () => {
        if (intent.intent !== "trade" && intent.intent !== "countertrade") {
          throw new SupervisorPrerequisiteError("create_trade_ticket is only allowed for trade or countertrade intent. For critic/watch requests, call finalize_run with analysis or critique.");
        }
        assertUsableMarketSelection(marketSelection);
        assertNonRejectedRiskDecision(riskDecision);
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "ticket",
          stepInput: { thesis, marketSelection, riskDecision, sizeUsd },
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

function prepareFinalInput(input: FinalizeRunInput): PreparedFinalizeRunInput {
  const publicSummary = finalPublicSummary(input, input);

  return {
    ...input,
    publicSummary,
  };
}

function finalPublicSummary(
  input: FinalizeRunInput,
  outputs: {
    critique?: Critique;
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
    marketSelection?: MarketSelection;
    riskDecision?: RiskDecision;
  },
): string {
  if (outputs.riskDecision?.decision === "reject") {
    return withDecisionContext(outputs.riskDecision.reason, outputs.tradeExpression, outputs.marketSelection);
  }

  if (input.responseType === "critique" && outputs.critique) {
    return withDecisionContext(outputs.critique.finalCritique, outputs.tradeExpression, outputs.marketSelection);
  }

  if (input.responseType === "analysis") {
    const basis = outputs.tradeExpression?.reason ?? outputs.researchReport?.publicSummary ?? input.publicSummary;
    return withDecisionContext(basis, outputs.tradeExpression, outputs.marketSelection);
  }

  return input.publicSummary;
}

function withDecisionContext(
  summary: string,
  tradeExpression?: TradeExpressionPlan,
  marketSelection?: MarketSelection,
): string {
  if (!tradeExpression) return summary;

  if (marketSelection?.noTradeReason) {
    return joinSentences(summary, `Market check came back no-trade: ${marketSelection.noTradeReason}`, insufficiencySentence(tradeExpression));
  }

  const selected = marketSelection?.selectedMarket
    ? `Cleanest expression: ${marketSideLabel(marketSelection.selectedMarket.side)} ${marketSelection.selectedMarket.symbol} on ${marketSelection.selectedMarket.venue}.`
    : "";
  return joinSentences(summary, decisionSentence(tradeExpression), selected, insufficiencySentence(tradeExpression));
}

function decisionSentence(tradeExpression: TradeExpressionPlan): string {
  if (tradeExpression.decision === "no_trade") {
    return `Trade read: no clean trade. ${tradeExpression.highestPurityExpression}`;
  }
  if (tradeExpression.decision === "needs_market_check") {
    return `Next step: check the matching venue or market before treating this as tradable. ${tradeExpression.highestPurityExpression}`;
  }
  return `Next step: route the cleanest candidate to market selection. ${tradeExpression.highestPurityExpression}`;
}

function insufficiencySentence(tradeExpression: TradeExpressionPlan): string {
  if (!tradeExpression.insufficiency || tradeExpression.insufficiency.score >= tradeExpression.insufficiency.requiredThreshold) {
    return "";
  }
  const dimensions = tradeExpression.insufficiency.failedDimensions.map(formatDimension).join(", ");
  return `Evidence is still below Cassie's bar because of ${dimensions}; needed: ${tradeExpression.insufficiency.evidenceNeededToClear.join("; ")}.`;
}

function formatDimension(dimension: string): string {
  return dimension.replaceAll("_", " ");
}

function marketSideLabel(side: string): string {
  switch (side) {
    case "buy_yes":
      return "buy YES";
    case "buy_no":
      return "buy NO";
    default:
      return side;
  }
}

function joinSentences(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.endsWith(".") || part.endsWith("!") || part.endsWith("?") ? part : `${part}.`)
    .join(" ");
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

  if (input.responseType === "critique") {
    if (!input.critique) {
      throw new SupervisorPrerequisiteError("finalize_run critique response requires critique analysis.");
    }
    return;
  }

  const hasMeaningfulAnalysisBasis = Boolean(
    input.researchReport ||
      input.tradeExpression ||
      input.marketSelection ||
      input.riskDecision ||
      input.critique ||
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
      warnings: input.researchReport?.warnings ?? [],
    });
  }
  if (input.responseType === "critique") {
    return SupervisorFinalResultSchema.parse({
      responseType: input.responseType,
      actionState,
      publicSummary: input.publicSummary,
      runStatus: "succeeded",
      ticketId: null,
      warnings: input.researchReport?.warnings ?? [],
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
    warnings: input.researchReport?.warnings ?? [],
  });
}

function resolveActionState(input: PreparedFinalizeRunInput): CassieActionState {
  if (input.responseType === "trade_ticket") return "create_ticket";
  if (input.intent?.intent === "watch") return "watchlist";
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

function isInsufficientEvidence(tradeExpression?: TradeExpressionPlan): boolean {
  if (!tradeExpression) return true;
  if (tradeExpression.insufficiency && tradeExpression.insufficiency.score < tradeExpression.insufficiency.requiredThreshold) {
    return true;
  }
  return typeof tradeExpression.tradeExpressionConfidence === "number" && tradeExpression.tradeExpressionConfidence < 0.65;
}
