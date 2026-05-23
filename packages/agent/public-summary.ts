import type {
  MarketSelection,
  RiskDecision,
  TradeExpressionPlan,
} from "../core/schemas/index.ts";

type PublicSummaryFinalizeInput = {
  responseType: "analysis" | "trade_ticket";
  publicSummary: string;
  tradeExpression?: TradeExpressionPlan;
  marketSelection?: MarketSelection;
  riskDecision?: RiskDecision;
};

export function prepareFinalInput<T extends PublicSummaryFinalizeInput>(input: T): T {
  const publicSummary = finalPublicSummary(input, input);

  return {
    ...input,
    publicSummary,
  };
}

function finalPublicSummary(
  input: PublicSummaryFinalizeInput,
  outputs: {
    tradeExpression?: TradeExpressionPlan;
    marketSelection?: MarketSelection;
    riskDecision?: RiskDecision;
  },
): string {
  if (outputs.riskDecision?.decision === "reject") {
    return withDecisionContext(outputs.riskDecision.reason, outputs.tradeExpression, outputs.marketSelection);
  }

  if (input.responseType === "analysis") {
    const basis = outputs.tradeExpression?.reason ?? input.publicSummary;
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
