import type { TradeExpressionPlan } from "../core/schemas/index.ts";

export function thesisFromTradeExpression(tradeExpression: TradeExpressionPlan) {
  return {
    claim: tradeExpression.coreInterpretation || tradeExpression.signal,
    literalClaim: tradeExpression.signal,
    impliedTradeThesis: tradeExpression.highestPurityExpression,
    sourceOrMetaSignal: null,
    hasExplicitTrade: true,
    hasTradableImplication: tradeExpression.decision !== "no_trade",
    thesisStrength: "explicit" as const,
    shouldNotInferTradeBecause: [],
    direction: directionFromTradeExpression(tradeExpression),
    mentionedAssets: tradeExpression.directAsset ? [tradeExpression.directAsset] : [],
    topics: [],
    timeHorizon: "unclear" as const,
    evidenceQuality: "unknown" as const,
    manipulationRisk: "unknown" as const,
    confidence: tradeExpression.tradeExpressionConfidence ?? 0.5,
  };
}

export function isInsufficientEvidence(tradeExpression?: TradeExpressionPlan): boolean {
  if (!tradeExpression) return true;
  if (tradeExpression.insufficiency && tradeExpression.insufficiency.score < tradeExpression.insufficiency.requiredThreshold) {
    return true;
  }
  return typeof tradeExpression.tradeExpressionConfidence === "number" && tradeExpression.tradeExpressionConfidence < 0.65;
}

function directionFromTradeExpression(tradeExpression: TradeExpressionPlan) {
  const rankedSide = tradeExpression.rankedCandidates
    ?.slice()
    .sort((left, right) => left.rank - right.rank)
    .find((candidate) => candidate.tradableNow)?.side;
  const rankedDirection = directionFromSide(rankedSide);
  if (rankedDirection) return rankedDirection;

  const candidateExpression = tradeExpression.candidates
    .find((candidate) => candidate.tradableNow && candidate.expression !== "market_check" && candidate.expression !== "no_trade")
    ?.expression;
  if (candidateExpression === "long") return "bullish" as const;
  if (candidateExpression === "short") return "bearish" as const;

  return "unclear" as const;
}

function directionFromSide(side?: string) {
  if (side === "long" || side === "buy" || side === "buy_yes") return "bullish" as const;
  if (side === "short" || side === "sell" || side === "buy_no") return "bearish" as const;
  return null;
}
