import { tool } from "ai";
import { z } from "zod";
import type { CassieDependencies } from "../../../workflows/dependencies.ts";
import type { CassieStore } from "../../../db/store.ts";
import {
  HyperliquidAccountStateProvider,
  type AccountStateProvider,
} from "../../../execution/account-state.ts";
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
  type MarketCandidate,
  type ResearchReport,
  type RiskDecision,
  type SignalInterpretation,
  type Thesis,
  type TradeTicket,
  type TradeExpressionPlan,
  type RunStepType,
  type UserSettings,
} from "../../../core/schemas/index.ts";
import { routeIntent } from "../../tools/intent-router.ts";
import { interpretSignal } from "../../tools/signal.ts";
import { critiqueThesis } from "../../tools/critique.ts";
import { findPolymarketMarkets, selectMarket } from "../../tools/market.ts";
import { planTradeExpression } from "../../tools/trade-expression.ts";
import { researchThesis } from "../../../research/index.ts";
import { evaluateRisk } from "../../../risk/index.ts";
import { extractInverseThesis, extractThesis } from "../../tools/thesis.ts";
import { createTradeTicket } from "../../tools/trade.ts";
import { recordRunStep } from "./steps.ts";

const promptVersion = "2026-05-20";

const NonRejectedRiskDecisionSchema = z.object({
  decision: z.enum(["approve", "require_approval", "create_ticket_only"]),
  adjustedSizeUsd: z.number().positive().optional(),
  reason: z.string().optional(),
});

const FinalizeRunInputSchema = z.object({
  responseType: z.enum(["analysis", "critique", "trade_ticket"]),
  publicSummary: z.string(),
  intent: IntentResultSchema.optional(),
  thesis: ThesisSchema.optional(),
  marketSelection: MarketSelectionSchema.optional(),
  critique: CritiqueSchema.optional(),
  researchReport: ResearchReportSchema.optional(),
  tradeExpression: TradeExpressionPlanSchema.optional(),
  riskDecision: RiskDecisionSchema.optional(),
  tradeTicket: z.object({ ticketId: z.string() }).optional(),
});

type FinalizeRunInput = z.infer<typeof FinalizeRunInputSchema>;

export async function finalizeRunFromPersistedSteps(input: {
  store: CassieStore;
  run: ControlRun;
}) {
  const [intent, thesis, researchReport, critique, tradeExpression, marketSelection, riskDecision, tradeTicket] = await Promise.all([
    tryCanonicalStepOutput<IntentResult>(input.store, input.run.runId, "intent", IntentResultSchema),
    tryCanonicalStepOutput<Thesis>(input.store, input.run.runId, "thesis", ThesisSchema),
    tryCanonicalStepOutput<ResearchReport>(input.store, input.run.runId, "research", ResearchReportSchema),
    tryCanonicalStepOutput<Critique>(input.store, input.run.runId, "critique", CritiqueSchema),
    tryCanonicalStepOutput<TradeExpressionPlan>(input.store, input.run.runId, "trade_expression", TradeExpressionPlanSchema),
    tryCanonicalStepOutput<MarketSelection>(input.store, input.run.runId, "market_selection", MarketSelectionSchema),
    tryCanonicalStepOutput<RiskDecision>(input.store, input.run.runId, "risk", RiskDecisionSchema),
    tryCanonicalStepOutput<TradeTicket>(input.store, input.run.runId, "ticket", TradeTicketSchema),
  ]);

  const finalInput: FinalizeRunInput = {
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
  const canonicalFinalInput = await canonicalizeFinalInput(input.store, input.run.runId, finalInput);

  return recordRunStep({
    store: input.store,
    runId: input.run.runId,
    stepType: "final",
    stepInput: canonicalFinalInput,
    execute: async () => {
      await validateFinalizationPrerequisites({
        store: input.store,
        runId: input.run.runId,
        input: canonicalFinalInput,
      });
      const result = finalizeResult(canonicalFinalInput);
      await input.store.updateRun({
        ...input.run,
        status: canonicalFinalInput.responseType === "trade_ticket" ? "awaiting_approval" as const : "succeeded" as const,
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
  const cheapModel = process.env.CASSIE_CHEAP_MODEL ?? "deepseek/deepseek-v4-flash";
  const importantModel = process.env.CASSIE_IMPORTANT_MODEL ?? "gemini-3.5-flash";
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
      execute: async ({ signal }) => runStepOnce("thesis", () => recordRunStep({
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
      })),
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
      inputSchema: z.object({ thesis: ThesisSchema }),
      execute: async ({ thesis }) => runStepOnce("inverse_thesis", () => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "inverse_thesis",
        promptName: "cassie_inverse_thesis",
        promptVersion,
        model: cheapModel,
        stepInput: { thesis },
        execute: () => extractInverseThesis({ ai: cheapAi, thesis }),
      })),
    }),
    research_thesis: tool({
      description: "Run Cassie's research subagent. It verifies evidence but never chooses markets or executes orders.",
      inputSchema: z.object({
        signal: SignalInterpretationSchema,
        thesis: ThesisSchema,
        researchAngle: z.enum(["balanced", "critic", "counter"]),
      }),
      execute: async ({ signal, thesis, researchAngle }) => runStepOnce("research", () => recordRunStep({
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
      })),
    }),
    critique_thesis: tool({
      description: "Critique a researched thesis and identify weaknesses without creating a trade.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema,
      }),
      execute: async ({ thesis, researchReport }) => runStepOnce("critique", async () => {
        const canonicalThesis = await getCanonicalStepOutput(input.store, input.run.runId, "thesis", ThesisSchema, thesis);
        const canonicalResearchReport = await getCanonicalStepOutput(
          input.store,
          input.run.runId,
          "research",
          ResearchReportSchema,
          researchReport,
        );
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "critique",
          promptName: "cassie_critique",
          promptVersion,
          model: importantModel,
          stepInput: { thesis: canonicalThesis, researchReport: canonicalResearchReport },
          execute: () => critiqueThesis({ ai: importantAi, thesis: canonicalThesis, researchReport: canonicalResearchReport }),
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
        const canonicalSignal = await getCanonicalStepOutput(input.store, input.run.runId, "signal", SignalInterpretationSchema, signal);
        const canonicalThesis = await getCanonicalStepOutput(input.store, input.run.runId, "thesis", ThesisSchema, thesis);
        const canonicalResearchReport = await getCanonicalStepOutput(
          input.store,
          input.run.runId,
          "research",
          ResearchReportSchema,
          researchReport,
        );
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
            signal: canonicalSignal,
            thesis: canonicalThesis,
            researchReport: canonicalResearchReport,
          },
          execute: () => planTradeExpression({
            ai: importantAi,
            sourcePost: input.run.sourcePost,
            userCommand: input.run.userCommand,
            signal: canonicalSignal,
            thesis: canonicalThesis,
            researchReport: canonicalResearchReport,
          }),
        });
      }),
    }),
    find_polymarket_markets: tool({
      description: "Find real Polymarket markets related to the researched thesis and trade expression.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema.optional(),
        tradeExpression: TradeExpressionPlanSchema.optional(),
        limit: z.number().int().positive().max(25).optional(),
      }),
      execute: async ({ thesis, researchReport, tradeExpression, limit }) => runStepOnce("market_candidates", async () => {
        const canonicalThesis = await getCanonicalStepOutput(input.store, input.run.runId, "thesis", ThesisSchema, thesis);
        const canonicalResearchReport = await getCanonicalStepOutput(
          input.store,
          input.run.runId,
          "research",
          ResearchReportSchema,
          researchReport,
        );
        const canonicalTradeExpression = await getCanonicalStepOutput(
          input.store,
          input.run.runId,
          "trade_expression",
          TradeExpressionPlanSchema,
          tradeExpression,
        );
        const polymarket = input.deps.polymarketMarketFinder;
        if (!polymarket) {
          throw new Error("Cassie supervisor requires a Polymarket market finder dependency.");
        }
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_candidates",
          stepInput: { thesis: canonicalThesis, researchReport: canonicalResearchReport, tradeExpression: canonicalTradeExpression, limit },
          execute: () => findPolymarketMarkets({
            polymarket,
            thesis: canonicalThesis,
            researchReport: canonicalResearchReport,
            tradeExpression: canonicalTradeExpression,
            limit,
          }),
        });
      }),
    }),
    select_market: tool({
      description: "Select the best market expression from real market candidates; do not invent markets.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema.optional(),
        tradeExpression: TradeExpressionPlanSchema.optional(),
      }),
      execute: async ({ thesis, researchReport, tradeExpression }) => runStepOnce("market_selection", async () => {
        const canonicalThesis = await getCanonicalStepOutput(input.store, input.run.runId, "thesis", ThesisSchema, thesis);
        const canonicalResearchReport = await getCanonicalStepOutput(
          input.store,
          input.run.runId,
          "research",
          ResearchReportSchema,
          researchReport,
        );
        const canonicalTradeExpression = await getCanonicalStepOutput(
          input.store,
          input.run.runId,
          "trade_expression",
          TradeExpressionPlanSchema,
          tradeExpression,
        );
        const polymarketCandidates = await tryCanonicalStepOutput<MarketCandidate[]>(
          input.store,
          input.run.runId,
          "market_candidates",
          MarketCandidateSchema.array(),
        );
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "market_selection",
          promptName: "cassie_market_selection",
          promptVersion,
          model: cheapModel,
          stepInput: { thesis: canonicalThesis, researchReport: canonicalResearchReport, tradeExpression: canonicalTradeExpression, candidates: polymarketCandidates },
          execute: () => selectMarket({
            ai: cheapAi,
            marketData: input.deps.marketData,
            thesis: canonicalThesis,
            researchReport: canonicalResearchReport,
            tradeExpression: canonicalTradeExpression,
            candidates: polymarketCandidates,
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
        void marketSelection;
        const canonicalMarketSelection = await requireCanonicalStepOutput(
          input.store,
          input.run.runId,
          "market_selection",
          MarketSelectionSchema,
          "Risk check requires a persisted usable market selection.",
        );
        assertUsableMarketSelection(canonicalMarketSelection);
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "risk",
          stepInput: { marketSelection: canonicalMarketSelection, sizeUsd },
          execute: async () => {
            const accountState = input.accountState ?? await (input.accountStateProvider ?? new HyperliquidAccountStateProvider())
              .getAccountState(input.userSettings);
            return evaluateRisk({
              marketSelection: canonicalMarketSelection,
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
        thesis: ThesisSchema,
        marketSelection: MarketSelectionSchema,
        riskDecision: NonRejectedRiskDecisionSchema,
        sizeUsd: z.number().positive().nullable().optional(),
      }),
      execute: async ({ thesis, marketSelection, riskDecision, sizeUsd }) => runStepOnce("ticket", async () => {
        void thesis;
        void marketSelection;
        void riskDecision;
        const canonicalThesis = await requireCanonicalStepOutput(
          input.store,
          input.run.runId,
          "thesis",
          ThesisSchema,
          "Trade ticket creation requires a persisted thesis.",
        );
        const canonicalMarketSelection = await requireCanonicalStepOutput(
          input.store,
          input.run.runId,
          "market_selection",
          MarketSelectionSchema,
          "Trade ticket creation requires a persisted usable market selection.",
        );
        assertUsableMarketSelection(canonicalMarketSelection);
        const canonicalRiskDecision = await requireCanonicalStepOutput(
          input.store,
          input.run.runId,
          "risk",
          RiskDecisionSchema,
          "Trade ticket creation requires a persisted non-rejected risk decision.",
        );
        assertNonRejectedRiskDecision(canonicalRiskDecision);
        return recordRunStep({
          store: input.store,
          runId: input.run.runId,
          stepType: "ticket",
          stepInput: { thesis: canonicalThesis, marketSelection: canonicalMarketSelection, riskDecision: canonicalRiskDecision, sizeUsd },
          execute: async () => {
            const ticket = createTradeTicket({
              runId: input.run.runId,
              userSettings: input.userSettings,
              thesis: canonicalThesis,
              marketSelection: canonicalMarketSelection,
              riskDecision: canonicalRiskDecision,
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
        const canonicalFinalInput = await canonicalizeFinalInput(input.store, input.run.runId, finalInput);
        return recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "final",
        stepInput: canonicalFinalInput,
        execute: async () => {
          await validateFinalizationPrerequisites({
            store: input.store,
            runId: input.run.runId,
            input: canonicalFinalInput,
          });
          const result = finalizeResult(canonicalFinalInput);
          const updated = {
            ...input.run,
            status: canonicalFinalInput.responseType === "trade_ticket" ? "awaiting_approval" as const : "succeeded" as const,
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

async function getCanonicalStepOutput<T>(
  store: CassieStore,
  runId: string,
  stepType: RunStepType,
  schema: z.ZodType<T>,
  fallback: unknown,
): Promise<T> {
  const steps = await store.getRunSteps(runId);
  const persisted = steps
    .filter((step) => step.stepType === stepType && step.status === "succeeded" && step.output != null)
    .at(-1)?.output;
  return schema.parse(persisted ?? fallback);
}

async function tryCanonicalStepOutput<T>(
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

async function requireCanonicalStepOutput<T>(
  store: CassieStore,
  runId: string,
  stepType: RunStepType,
  schema: z.ZodType<T>,
  message: string,
): Promise<T> {
  const output = await tryCanonicalStepOutput<T>(store, runId, stepType, schema);
  if (output == null) {
    throw new Error(message);
  }
  return output;
}

function assertUsableMarketSelection(selection: MarketSelection): void {
  if (!selection.selectedMarket || selection.noTradeReason) {
    throw new Error("Risk check requires a persisted usable market selection.");
  }
}

function assertNonRejectedRiskDecision(decision: RiskDecision): void {
  if (decision.decision === "reject") {
    throw new Error("Trade ticket creation requires a persisted non-rejected risk decision.");
  }
}

async function canonicalizeFinalInput(
  store: CassieStore,
  runId: string,
  input: FinalizeRunInput,
): Promise<FinalizeRunInput> {
  const [intent, thesis, researchReport, critique, tradeExpression, marketSelection, riskDecision] = await Promise.all([
    tryCanonicalStepOutput<IntentResult>(store, runId, "intent", IntentResultSchema),
    tryCanonicalStepOutput<Thesis>(store, runId, "thesis", ThesisSchema),
    tryCanonicalStepOutput<ResearchReport>(store, runId, "research", ResearchReportSchema),
    tryCanonicalStepOutput<Critique>(store, runId, "critique", CritiqueSchema),
    tryCanonicalStepOutput<TradeExpressionPlan>(store, runId, "trade_expression", TradeExpressionPlanSchema),
    tryCanonicalStepOutput<MarketSelection>(store, runId, "market_selection", MarketSelectionSchema),
    tryCanonicalStepOutput<RiskDecision>(store, runId, "risk", RiskDecisionSchema),
  ]);

  const publicSummary = canonicalPublicSummary(input, {
    critique,
    researchReport,
    tradeExpression,
    marketSelection,
    riskDecision,
  });

  return {
    ...input,
    publicSummary,
    intent: intent ?? input.intent,
    thesis: thesis ?? input.thesis,
    researchReport: researchReport ?? input.researchReport,
    tradeExpression: tradeExpression ?? input.tradeExpression,
    critique: critique ?? input.critique,
    marketSelection,
    riskDecision: riskDecision ?? input.riskDecision,
  };
}

function canonicalPublicSummary(
  input: FinalizeRunInput,
  canonical: {
    critique?: Critique;
    researchReport?: ResearchReport;
    tradeExpression?: TradeExpressionPlan;
    marketSelection?: MarketSelection;
    riskDecision?: RiskDecision;
  },
): string {
  if (canonical.riskDecision?.decision === "reject") {
    return withDecisionContext(canonical.riskDecision.reason, canonical.tradeExpression, canonical.marketSelection);
  }

  if (input.responseType === "critique" && canonical.critique) {
    return withDecisionContext(canonical.critique.finalCritique, canonical.tradeExpression, canonical.marketSelection);
  }

  if (input.responseType === "analysis") {
    const basis = canonical.tradeExpression?.reason ?? canonical.researchReport?.publicSummary ?? input.publicSummary;
    return withDecisionContext(basis, canonical.tradeExpression, canonical.marketSelection);
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

async function validateFinalizationPrerequisites(input: {
  store: CassieStore;
  runId: string;
  input: FinalizeRunInput;
}) {
  if (input.input.responseType !== "critique") return;

  const steps = await input.store.getRunSteps(input.runId);
  const hasCompletedCritique = steps.some((step) => step.stepType === "critique" && step.status === "succeeded");
  if (!hasCompletedCritique) {
    throw new Error("finalize_run critique response requires a completed critique_thesis step.");
  }
  const hasCompletedTradeExpression = steps.some((step) => step.stepType === "trade_expression" && step.status === "succeeded");
  if (!hasCompletedTradeExpression) {
    throw new Error("finalize_run critique response requires a completed plan_trade_expression step.");
  }
}

function finalizeResult(input: FinalizeRunInput) {
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

function resolveActionState(input: FinalizeRunInput): CassieActionState {
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
