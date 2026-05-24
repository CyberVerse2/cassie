import type { TradeExpressionPlan } from "../core/schemas/index.ts";

export function thesisFromTradeExpression(tradeExpression: TradeExpressionPlan) {
  const candidateExpressions = tradeExpression.candidateExpressions ?? [];
  const legacyCandidates = tradeExpression.candidates ?? [];
  const primaryExpression = candidateExpressions
    .filter((candidate) => candidate.expressionRail !== "no_trade")
    .sort((left, right) => priorityWeight(right.priority) - priorityWeight(left.priority))[0];
  const mentionedAssets = Array.from(new Set([
    tradeExpression.directAsset,
    primaryExpression?.primaryEntityOrEvent,
    ...(primaryExpression?.relatedEntities ?? []),
    ...legacyCandidates.flatMap((candidate) => [candidate.symbol, candidate.instrument]),
  ].filter((value): value is string => Boolean(value))));

  return {
    claim: primaryExpression?.thesis ?? (tradeExpression.coreInterpretation || tradeExpression.signal),
    literalClaim: tradeExpression.signal,
    impliedTradeThesis: primaryExpression?.whyThisExpressesTheOpportunity ?? tradeExpression.highestPurityExpression,
    sourceOrMetaSignal: null,
    hasExplicitTrade: true,
    hasTradableImplication: tradeExpression.decision !== "no_trade",
    thesisStrength: "explicit" as const,
    shouldNotInferTradeBecause: [],
    direction: directionFromTradeExpression(tradeExpression),
    mentionedAssets,
    topics: candidateExpressions.flatMap((candidate) => candidate.searchTerms).slice(0, 20),
    timeHorizon: timeHorizonFromExpression(primaryExpression?.expectedTimeHorizon),
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
  const expressionSide = (tradeExpression.candidateExpressions ?? [])
    .filter((candidate) => candidate.expressionRail !== "no_trade")
    .sort((left, right) => priorityWeight(right.priority) - priorityWeight(left.priority))[0]?.intendedSide;
  const expressionDirection = directionFromSide(expressionSide);
  if (expressionDirection) return expressionDirection;

  const rankedSide = tradeExpression.rankedCandidates
    ?.slice()
    .sort((left, right) => left.rank - right.rank)
    .find((candidate) => candidate.tradableNow)?.side;
  const rankedDirection = directionFromSide(rankedSide);
  if (rankedDirection) return rankedDirection;

  const candidateExpression = (tradeExpression.candidates ?? [])
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

function priorityWeight(priority: string): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function timeHorizonFromExpression(value?: string) {
  if (value === "minutes" || value === "hours") return "intraday" as const;
  if (value === "days") return "days" as const;
  if (value === "weeks") return "weeks" as const;
  if (value === "months" || value === "year_plus") return "months" as const;
  return "unclear" as const;
}
