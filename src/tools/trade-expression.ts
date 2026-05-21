import type { StructuredAiClient } from "../ai.ts";
import { tradeExpressionPrompt } from "../prompts.ts";
import {
  TradeExpressionPlanSchema,
  type ResearchReport,
  type SignalInterpretation,
  type SourcePost,
  type Thesis,
  type TradeExpressionPlan,
} from "../schemas.ts";

export async function planTradeExpression(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
  signal: SignalInterpretation;
  thesis: Thesis;
  researchReport: ResearchReport;
}): Promise<TradeExpressionPlan> {
  return input.ai.generateObject({
    schema: TradeExpressionPlanSchema,
    name: "cassie_trade_expression",
    prompt: tradeExpressionPrompt({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      signal: input.signal,
      thesis: input.thesis,
      researchReport: input.researchReport,
    }),
  });
}

export function shouldRouteToMarket(expression: TradeExpressionPlan): boolean {
  return expression.decision === "route_to_market_router" &&
    expression.candidates.some((candidate) => candidate.tradableNow);
}
