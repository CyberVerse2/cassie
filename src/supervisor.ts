import type { StructuredAiClient } from "./ai.ts";
import type {
  Critique,
  IntentResult,
  MarketSelection,
  ResearchReport,
  RiskDecision,
  SourcePost,
  Thesis,
  TradeTicket,
  UserSettings,
  AccountState,
} from "./schemas.ts";
import type { MarketDataProvider } from "./tools/market.ts";
import type { ResearchSearchLanes } from "./tools/research.ts";
import { critiqueThesis } from "./tools/critique.ts";
import { routeIntent } from "./tools/intent-router.ts";
import { selectMarket } from "./tools/market.ts";
import { researchThesis } from "./tools/research.ts";
import { evaluateRisk } from "./tools/risk.ts";
import { extractInverseThesis, extractThesis } from "./tools/thesis.ts";
import { createTradeTicket } from "./tools/trade.ts";

export type CassieRun =
  | {
      intent: IntentResult;
      thesis: Thesis;
      marketSelection: MarketSelection;
      riskDecision: RiskDecision;
      responseType: "analysis";
    }
  | {
      intent: IntentResult;
      thesis: Thesis;
      researchReport: ResearchReport;
      critique: Critique;
      responseType: "critique";
    }
  | {
      intent: IntentResult;
      thesis: Thesis;
      researchReport: ResearchReport;
      marketSelection: MarketSelection;
      riskDecision: RiskDecision;
      tradeTicket: TradeTicket;
      responseType: "trade_ticket";
    };

export interface CassieDependencies {
  ai: StructuredAiClient;
  marketData: MarketDataProvider;
  researchLanes: ResearchSearchLanes;
}

export async function runCassie(input: {
  deps: CassieDependencies;
  sourcePost: SourcePost;
  userSettings: UserSettings;
  accountState: AccountState;
  userCommand: string;
}): Promise<CassieRun> {
  const intent = await routeIntent({
    ai: input.deps.ai,
    sourcePost: input.sourcePost,
    userCommand: input.userCommand,
  });

  const thesis = await extractThesis({
    ai: input.deps.ai,
    sourcePost: input.sourcePost,
    userCommand: input.userCommand,
  });

  if (intent.intent === "critic") {
    const researchReport = await researchThesis({
      ai: input.deps.ai,
      lanes: input.deps.researchLanes,
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      thesis,
      researchAngle: "critic",
    });

    const critique = await critiqueThesis({
      ai: input.deps.ai,
      thesis,
      researchReport,
    });

    return {
      intent,
      thesis,
      researchReport,
      critique,
      responseType: "critique",
    };
  }

  if (intent.intent === "countertrade") {
    const inverse = await extractInverseThesis({
      ai: input.deps.ai,
      thesis,
    });
    const inverseThesis: Thesis = {
      ...thesis,
      claim: inverse.inverseClaim,
      direction: inverse.inverseDirection,
      mentionedAssets: inverse.mentionedAssets,
      topics: inverse.topics,
      timeHorizon: inverse.timeHorizon,
      confidence: inverse.confidence,
    };

    const researchReport = await researchThesis({
      ai: input.deps.ai,
      lanes: input.deps.researchLanes,
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      thesis: inverseThesis,
      researchAngle: "counter",
    });

    const marketSelection = await selectMarket({
      ai: input.deps.ai,
      marketData: input.deps.marketData,
      thesis: inverseThesis,
      researchReport,
    });
    const riskDecision = evaluateRisk({
      marketSelection,
      userSettings: input.userSettings,
      accountState: input.accountState,
      sizeUsd: intent.userSizeOverrideUsd,
    });
    const tradeTicket = createTradeTicket({
      userSettings: input.userSettings,
      thesis: inverseThesis,
      marketSelection,
      riskDecision,
      sizeUsd: intent.userSizeOverrideUsd,
    });

    return {
      intent,
      thesis: inverseThesis,
      researchReport,
      marketSelection,
      riskDecision,
      tradeTicket,
      responseType: "trade_ticket",
    };
  }

  const researchReport =
    intent.intent === "trade"
      ? await researchThesis({
          ai: input.deps.ai,
          lanes: input.deps.researchLanes,
          sourcePost: input.sourcePost,
          userCommand: input.userCommand,
          thesis,
          researchAngle: "balanced",
        })
      : undefined;

  const marketSelection = await selectMarket({
    ai: input.deps.ai,
    marketData: input.deps.marketData,
    thesis,
    researchReport,
  });
  const riskDecision = evaluateRisk({
    marketSelection,
    userSettings: input.userSettings,
    accountState: input.accountState,
    sizeUsd: intent.userSizeOverrideUsd,
  });

  if (intent.intent === "trade") {
    const tradeTicket = createTradeTicket({
      userSettings: input.userSettings,
      thesis,
      marketSelection,
      riskDecision,
      sizeUsd: intent.userSizeOverrideUsd,
    });

    return {
      intent,
      thesis,
      researchReport: researchReport as ResearchReport,
      marketSelection,
      riskDecision,
      tradeTicket,
      responseType: "trade_ticket",
    };
  }

  return {
    intent,
    thesis,
    marketSelection,
    riskDecision,
    responseType: "analysis",
  };
}
