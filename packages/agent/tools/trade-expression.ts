import type { StructuredAiClient } from "../../ai/client.ts";
import {
  opportunityFramePrompt,
  singleStepTradeExpressionPrompt,
} from "../../prompts/index.ts";
import {
  MarketCandidateSchema,
  OpportunityFrameSchema,
  TradeExpressionPlanSchema,
  type MarketCandidate,
  type OpportunityFrame,
  type SourcePost,
  type TradeExpressionPlan,
} from "../../core/schemas/index.ts";

export async function frameOpportunity(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<OpportunityFrame> {
  return OpportunityFrameSchema.parse(await input.ai.generateObject({
    schema: OpportunityFrameSchema,
    name: "cassie_opportunity_frame",
    prompt: opportunityFramePrompt({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
    }),
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

  return TradeExpressionPlanSchema.parse(await input.ai.generateObject({
    schema: TradeExpressionPlanSchema,
    name: "cassie_trade_expressions",
    prompt: singleStepTradeExpressionPrompt({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      opportunityFrame: input.opportunityFrame,
      marketCandidates,
    }),
  }));
}
