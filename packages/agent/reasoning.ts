import type { StructuredAiClient } from "../ai/client.ts";
import {
  MarketCandidateSchema,
  OpportunityFrameSchema,
  SourceModeClassificationSchema,
  TradeExpressionPlanSchema,
  type MarketCandidate,
  type OpportunityFrame,
  type SourcePost,
  type SourceModeClassification,
  type TradeExpressionPlan,
} from "../core/schemas/index.ts";
import { isConfiguredVenueSearchableExpressionRail } from "../core/expression-rails.ts";
import {
  opportunityFramePromptSpec,
  sourceModeClassificationPromptSpec,
  singleStepTradeExpressionPromptSpec,
  structuredPromptInput,
} from "../prompts/index.ts";

export async function classifySourceMode(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<SourceModeClassification> {
  return SourceModeClassificationSchema.parse(await input.ai.generateObject({
    ...structuredPromptInput(sourceModeClassificationPromptSpec({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
    })),
  }));
}

export async function frameOpportunity(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<OpportunityFrame> {
  return OpportunityFrameSchema.parse(await input.ai.generateObject({
    ...structuredPromptInput(opportunityFramePromptSpec({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
    })),
  }));
}

export async function generateTradeExpressions(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
  opportunityFrame?: OpportunityFrame;
  marketCandidates?: MarketCandidate[];
}): Promise<TradeExpressionPlan> {
  const marketCandidates = input.marketCandidates
    ? MarketCandidateSchema.array().parse(input.marketCandidates)
    : undefined;

  const tradeExpression = TradeExpressionPlanSchema.parse(await input.ai.generateObject({
    ...structuredPromptInput(singleStepTradeExpressionPromptSpec({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      opportunityFrame: input.opportunityFrame,
      marketCandidates,
    })),
  }));

  return normalizeTradeExpressionDecision(tradeExpression);
}

function normalizeTradeExpressionDecision(tradeExpression: TradeExpressionPlan): TradeExpressionPlan {
  if (tradeExpression.decision !== "no_trade" || !hasSearchableExpression(tradeExpression)) {
    return tradeExpression;
  }

  return {
    ...tradeExpression,
    decision: "needs_market_check",
    reason: tradeExpression.reason || "Venue discovery is required before finalizing no-trade.",
    marketRouterInstructions: tradeExpression.marketRouterInstructions
      ?? "Search configured venues for the non-no-trade candidate expressions before finalizing no-trade.",
  };
}

function hasSearchableExpression(tradeExpression: TradeExpressionPlan): boolean {
  return tradeExpression.candidateExpressions.some((candidate) =>
    isConfiguredVenueSearchableExpressionRail(candidate.expressionRail)
      && candidate.intendedSide !== "avoid"
      && candidate.searchTerms.length > 0
      && candidate.requiredMarketFeatures.length > 0,
  );
}
