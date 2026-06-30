import type { StructuredAiClient } from "../ai/client.ts";
import {
  MarketCandidateSchema,
  OpportunityFrameSchema,
  OpportunityTradePlanSchema,
  SourceContextDiscoverySchema,
  SourceModeClassificationSchema,
  TradeExpressionPlanSchema,
  type MarketCandidate,
  type OpportunityFrame,
  type OpportunityTradePlan,
  type SourceContextDiscovery,
  type SourcePost,
  type SourceModeClassification,
  type TradeExpressionPlan,
} from "../core/schemas/index.ts";
import { isConfiguredVenueSearchableExpressionRail } from "../core/expression-rails.ts";
import {
  opportunityFramePromptSpec,
  opportunityTradePlanPromptSpec,
  sourceContextDiscoveryPromptSpec,
  sourceModeClassificationPromptSpec,
  singleStepTradeExpressionPromptSpec,
  structuredPromptInput,
} from "../prompts/index.ts";

export async function classifySourceMode(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<SourceModeClassification> {
  return SourceModeClassificationSchema.parse(
    await input.ai.generateObject({
      ...structuredPromptInput(
        sourceModeClassificationPromptSpec({
          sourcePost: input.sourcePost,
          userCommand: input.userCommand,
        }),
      ),
    }),
  );
}

export async function discoverSourceContext(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<SourceContextDiscovery> {
  return SourceContextDiscoverySchema.parse(
    await input.ai.generateObject({
      ...structuredPromptInput(
        sourceContextDiscoveryPromptSpec({
          sourcePost: input.sourcePost,
          userCommand: input.userCommand,
        }),
      ),
    }),
  );
}

export async function frameOpportunity(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<OpportunityFrame> {
  return OpportunityFrameSchema.parse(
    await input.ai.generateObject({
      ...structuredPromptInput(
        opportunityFramePromptSpec({
          sourcePost: input.sourcePost,
          userCommand: input.userCommand,
        }),
      ),
    }),
  );
}

export async function planOpportunityAndTradeExpressions(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
  marketCandidates?: MarketCandidate[];
  contextDiscovery?: SourceContextDiscovery | null;
}): Promise<OpportunityTradePlan> {
  const marketCandidates = input.marketCandidates
    ? MarketCandidateSchema.array().parse(input.marketCandidates)
    : undefined;

  const plan = OpportunityTradePlanSchema.parse(
    await input.ai.generateObject({
      ...structuredPromptInput(
        opportunityTradePlanPromptSpec({
          sourcePost: input.sourcePost,
          userCommand: input.userCommand,
          marketCandidates,
          contextDiscovery: input.contextDiscovery,
        }),
      ),
    }),
  );

  return {
    ...plan,
    tradeExpression: normalizeTradeExpressionDecision(plan.tradeExpression),
  };
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

  const tradeExpression = TradeExpressionPlanSchema.parse(
    await input.ai.generateObject({
      ...structuredPromptInput(
        singleStepTradeExpressionPromptSpec({
          sourcePost: input.sourcePost,
          userCommand: input.userCommand,
          opportunityFrame: input.opportunityFrame,
          marketCandidates,
        }),
      ),
    }),
  );

  return normalizeTradeExpressionDecision(tradeExpression);
}

function normalizeTradeExpressionDecision(
  tradeExpression: TradeExpressionPlan,
): TradeExpressionPlan {
  if (
    tradeExpression.decision !== "no_trade" ||
    !hasSearchableExpression(tradeExpression)
  ) {
    return tradeExpression;
  }

  return {
    ...tradeExpression,
    decision: "needs_market_check",
    reason:
      tradeExpression.reason ||
      "Venue discovery is required before finalizing no-trade.",
    marketDiscovery: tradeExpression.marketDiscovery ?? {
      status: "needed" as const,
      venues: [],
      missing: ["market_discovery" as const],
      instructions:
        "Search configured venues for the non-no-trade candidate expressions before finalizing no-trade.",
      queries: tradeExpression.candidateExpressions.map((candidate) => ({
        expressionId: candidate.expressionId,
        terms: candidate.searchTerms,
      })),
    },
  };
}

function hasSearchableExpression(
  tradeExpression: TradeExpressionPlan,
): boolean {
  return tradeExpression.candidateExpressions.some(
    (candidate) =>
      isConfiguredVenueSearchableExpressionRail(candidate.expressionRail) &&
      candidate.intendedSide !== "avoid" &&
      candidate.searchTerms.length > 0 &&
      candidate.requiredMarketFeatures.length > 0,
  );
}
