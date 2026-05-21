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
  MarketSelectionSchema,
  ResearchReportSchema,
  SignalInterpretationSchema,
  ThesisSchema,
  TradeTicketSchema,
  type AccountState,
  type ControlRun,
  type UserSettings,
} from "../../../core/schemas/index.ts";
import { routeIntent } from "../../tools/intent-router.ts";
import { interpretSignal } from "../../tools/signal.ts";
import { critiqueThesis } from "../../tools/critique.ts";
import { selectMarket } from "../../tools/market.ts";
import { researchThesis } from "../../../research/index.ts";
import { evaluateRisk } from "../../../risk/index.ts";
import { extractInverseThesis, extractThesis } from "../../tools/thesis.ts";
import { createTradeTicket } from "../../tools/trade.ts";
import { recordRunStep } from "./steps.ts";

const promptVersion = "2026-05-20";

const NonRejectedRiskDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    adjustedSizeUsd: z.number().positive(),
  }),
  z.object({
    decision: z.literal("require_approval"),
    reason: z.string(),
  }),
  z.object({
    decision: z.literal("create_ticket_only"),
    reason: z.string(),
  }),
]);

const FinalizeRunInputSchema = z.object({
  responseType: z.enum(["analysis", "critique", "trade_ticket"]),
  publicSummary: z.string(),
  thesis: ThesisSchema.optional(),
  marketSelection: MarketSelectionSchema.optional(),
  critique: CritiqueSchema.optional(),
  researchReport: ResearchReportSchema.optional(),
  tradeTicket: TradeTicketSchema.or(z.object({ ticketId: z.string() })).optional(),
});

type FinalizeRunInput = z.infer<typeof FinalizeRunInputSchema>;

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

  return {
    classify_intent: tool({
      description: "Classify the user's Cassie command into think, critic, trade, or countertrade.",
      inputSchema: z.object({}),
      execute: async () => recordRunStep({
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
      }),
    }),
    extract_thesis: tool({
      description: "Extract the market thesis from the source post and command.",
      inputSchema: z.object({
        signal: SignalInterpretationSchema,
      }),
      execute: async ({ signal }) => recordRunStep({
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
      }),
    }),
    interpret_signal: tool({
      description: "Classify the source post into signal type, lead quality, tradability, and research angles.",
      inputSchema: z.object({}),
      execute: async () => recordRunStep({
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
      }),
    }),
    extract_inverse_thesis: tool({
      description: "Create the strongest opposing thesis for a countertrade or fade request.",
      inputSchema: z.object({ thesis: ThesisSchema }),
      execute: async ({ thesis }) => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "inverse_thesis",
        promptName: "cassie_inverse_thesis",
        promptVersion,
        model: cheapModel,
        stepInput: { thesis },
        execute: () => extractInverseThesis({ ai: cheapAi, thesis }),
      }),
    }),
    research_thesis: tool({
      description: "Run Cassie's research subagent. It verifies evidence but never chooses markets or executes orders.",
      inputSchema: z.object({
        signal: SignalInterpretationSchema,
        thesis: ThesisSchema,
        researchAngle: z.enum(["balanced", "critic", "counter"]),
      }),
      execute: async ({ signal, thesis, researchAngle }) => recordRunStep({
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
      }),
    }),
    critique_thesis: tool({
      description: "Critique a researched thesis and identify weaknesses without creating a trade.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema,
      }),
      execute: async ({ thesis, researchReport }) => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "critique",
        promptName: "cassie_critique",
        promptVersion,
        model: importantModel,
        stepInput: { thesis, researchReport },
        execute: () => critiqueThesis({ ai: importantAi, thesis, researchReport }),
      }),
    }),
    select_market: tool({
      description: "Select the best market expression from real market candidates; do not invent markets.",
      inputSchema: z.object({
        thesis: ThesisSchema,
        researchReport: ResearchReportSchema.optional(),
      }),
      execute: async ({ thesis, researchReport }) => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "market_selection",
        promptName: "cassie_market_selection",
        promptVersion,
        model: cheapModel,
        stepInput: { thesis, researchReport },
        execute: () => selectMarket({
          ai: cheapAi,
          marketData: input.deps.marketData,
          thesis,
          researchReport,
        }),
      }),
    }),
    risk_check: tool({
      description: "Run deterministic risk checks against user policy and live account state.",
      inputSchema: z.object({
        marketSelection: MarketSelectionSchema,
        sizeUsd: z.number().positive().nullable().optional(),
      }),
      execute: async ({ marketSelection, sizeUsd }) => recordRunStep({
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
      execute: async ({ thesis, marketSelection, riskDecision, sizeUsd }) => recordRunStep({
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
      }),
    }),
    finalize_run: tool({
      description: "Finalize the Cassie run with the user-facing result after analysis, critique, or trade-ticket creation.",
      inputSchema: FinalizeRunInputSchema,
      execute: async (finalInput) => recordRunStep({
        store: input.store,
        runId: input.run.runId,
        stepType: "final",
        stepInput: finalInput,
        execute: async () => {
          const result = finalizeResult(finalInput);
          const updated = {
            ...input.run,
            status: finalInput.responseType === "trade_ticket" ? "awaiting_approval" as const : "succeeded" as const,
            result,
            error: null,
            updatedAt: new Date().toISOString(),
          };
          await input.store.updateRun(updated);
          return updated.result;
        },
      }),
    }),
  };
}

function finalizeResult(input: FinalizeRunInput) {
  if (input.responseType === "analysis") {
    return {
      responseType: input.responseType,
      result: {
        publicSummary: input.publicSummary,
        thesis: input.thesis,
        marketSelection: input.marketSelection,
      },
    };
  }
  if (input.responseType === "critique") {
    if (!input.critique) {
      throw new Error("finalize_run critique response requires critique.");
    }
    return {
      responseType: input.responseType,
      result: {
        publicSummary: input.publicSummary,
        critique: input.critique,
        researchReport: input.researchReport,
      },
    };
  }
  if (!input.tradeTicket) {
    throw new Error("finalize_run trade_ticket response requires tradeTicket.");
  }
  return {
    responseType: input.responseType,
    result: {
      publicSummary: input.publicSummary,
      tradeTicket: input.tradeTicket,
    },
  };
}
