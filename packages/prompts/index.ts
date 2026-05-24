import type { MarketCandidate, OpportunityFrame, SourcePost, Thesis } from "../core/schemas/index.ts";

export function marketSelectionPrompt(input: {
  thesis: Thesis;
  candidates: unknown[];
  tradeExpression?: unknown;
}): string {
  void input;
  return promptRewriteRequired();
}

export function polymarketDiscoveryQueryPrompt(input: {
  thesis: Thesis;
  tradeExpression?: unknown;
  limit: number;
}): string {
  void input;
  return promptRewriteRequired();
}

export function opportunityFramePrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): string {
  void input;
  return promptRewriteRequired();
}

export function singleStepTradeExpressionPrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
  opportunityFrame?: OpportunityFrame;
  marketCandidates?: MarketCandidate[];
}): string {
  void input;
  return promptRewriteRequired();
}

function promptRewriteRequired(): never {
  throw new Error("Cassie prompts have been removed and must be rewritten before AI runs.");
}
