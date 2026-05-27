import { z } from "zod";

export const CassieIntentSchema = z.enum([
  "critic",
  "trade",
  "countertrade",
  "watch",
]);

export const DirectionSchema = z.enum([
  "bullish",
  "bearish",
  "neutral",
  "unclear",
]);

export const TimeHorizonSchema = z.enum([
  "intraday",
  "days",
  "weeks",
  "months",
  "event_based",
  "unclear",
]);

export const SourcePostSchema = z.object({
  platform: z.literal("x"),
  postId: z.string().nullable(),
  url: z.string().nullable(),
  authorHandle: z.string().nullable(),
  authorName: z.string().nullable(),
  text: z.string().min(1),
  createdAt: z.string().nullable(),
  quotedPostText: z.string().nullable(),
  linkedUrls: z.array(z.string()),
  mediaDescriptions: z.array(z.string()),
});

export const UserSettingsSchema = z.object({
  userId: z.string(),
  walletAddress: z.string().nullable().default(null),
  defaultTradeSizeUsd: z.number().positive(),
});

export const ThesisSchema = z.object({
  claim: z.string(),
  literalClaim: z.string().nullable().optional(),
  impliedTradeThesis: z.string().nullable().optional(),
  sourceOrMetaSignal: z.string().nullable().optional(),
  hasExplicitTrade: z.boolean().optional(),
  hasTradableImplication: z.boolean().optional(),
  thesisStrength: z.enum(["none", "weak_inferred", "moderate_inferred", "explicit"]).optional(),
  shouldNotInferTradeBecause: z.array(z.string()).optional(),
  direction: DirectionSchema,
  mentionedAssets: z.array(z.string()),
  topics: z.array(z.string()),
  timeHorizon: TimeHorizonSchema,
  evidenceQuality: z.enum(["strong", "medium", "weak", "unknown"]),
  manipulationRisk: z.enum(["low", "medium", "high", "unknown"]),
  confidence: z.number().min(0).max(1),
});

export const MarketCandidateSchema = z.object({
  venue: z.string(),
  instrument: z.string(),
  side: z.enum(["long", "short", "buy_yes", "buy_no", "buy", "sell"]),
  symbol: z.string(),
  conditionId: z.string().nullable(),
  outcomeTokenId: z.string().nullable(),
  yesOutcomeTokenId: z.string().nullable(),
  noOutcomeTokenId: z.string().nullable(),
  marketQuestion: z.string().nullable(),
  marketSlug: z.string().nullable(),
  outcome: z.enum(["yes", "no"]).nullable(),
  yesPrice: z.number().positive().max(1).nullable(),
  noPrice: z.number().positive().max(1).nullable(),
  heldSidePrice: z.number().positive().max(1).nullable(),
  volumeUsd: z.number().nonnegative().nullable(),
  liquidityUsd: z.number().nonnegative().nullable(),
  endDate: z.string().nullable(),
  warnings: z.array(z.string()),
  markPrice: z.number().positive().nullable(),
  liquidityScore: z.number().min(0).max(1),
  spreadBps: z.number().nonnegative(),
  estimatedSlippageBps: z.number().nonnegative().default(0),
  minOrderSizeUsd: z.number().nonnegative().default(0),
  thesisFit: z.number().min(0).max(1),
  reason: z.string(),
});

export const OpportunityFrameSchema = z.object({
  literalClaim: z.string(),
  opportunity: z.string(),
  marketImplication: z.string(),
  userIntent: CassieIntentSchema,
  affectedEntities: z.array(z.string()),
  affectedAssets: z.array(z.string()),
  expressionFamilies: z.array(z.string()),
  signalVerificationRisk: z.enum(["low", "medium", "high", "unknown"])
    .describe("The risk that the source claim is false, misleading, stale, unverifiable, or missing critical context."),
  shouldVerifyTruthBeforeTrading: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export const PolymarketMarketAssessmentSchema = z.object({
  fit: z.enum(["strong", "weak", "no_fit"]),
  fitReason: z.string(),
  warnings: z.array(z.string()),
  trade: MarketCandidateSchema.extend({
    venue: z.literal("polymarket"),
    conditionId: z.string().min(1),
    outcomeTokenId: z.string().min(1),
    marketQuestion: z.string().min(1),
    marketSlug: z.string().min(1),
    outcome: z.enum(["yes", "no"]),
    yesPrice: z.number().positive().max(1),
    noPrice: z.number().positive().max(1),
    heldSidePrice: z.number().positive().max(1),
  }),
});

export const PolymarketQuoteSchema = z.object({
  conditionId: z.string().nullable().optional(),
  outcomeTokenId: z.string().min(1),
  outcome: z.enum(["yes", "no"]),
  yesPrice: z.number().positive().max(1).nullable(),
  noPrice: z.number().positive().max(1).nullable(),
  heldSidePrice: z.number().positive().max(1),
  bid: z.number().positive().max(1),
  ask: z.number().positive().max(1),
  midPrice: z.number().positive().max(1),
  spreadBps: z.number().nonnegative(),
  timestamp: z.string(),
});

export const TradeVenueDataSchema = z.object({
  symbol: z.string().nullable().optional(),
  conditionId: z.string().nullable().optional(),
  outcomeTokenId: z.string().nullable().optional(),
  markPrice: z.number().positive().nullable().optional(),
  spreadBps: z.number().nonnegative().optional(),
  estimatedSlippageBps: z.number().nonnegative().optional(),
  minOrderSizeUsd: z.number().nonnegative().optional(),
});

export const MarketSelectionSchema = z.object({
  decision: z.enum(["select_market", "no_selection"]),
  selectedMarket: MarketCandidateSchema.nullable(),
  selectedCandidateId: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  rankedCandidates: z.array(z.object({
    candidateId: z.string(),
    thesisFit: z.number().min(0).max(1),
    liquidityFit: z.number().min(0).max(1),
    payoffFit: z.number().min(0).max(1),
    reason: z.string(),
  })),
  rejectedCandidates: z.array(
    z.object({
      venue: z.string(),
      symbol: z.string(),
      reason: z.string(),
    }),
  ),
  noTradeReason: z.string().nullable(),
});

export const CandidateTradeExpressionSchema = z.object({
  expressionId: z.string(),
  expressionRail: z.enum(["crypto", "pre_ipo", "prediction_market", "no_trade"]),
  expressionType: z.enum([
    "directional",
    "event_probability",
    "proxy",
    "relative_value",
    "rules_mismatch",
    "no_trade",
  ]),
  abstractMarket: z.string(),
  intendedSide: z.enum(["long", "short", "yes", "no", "avoid"]),
  primaryEntityOrEvent: z.string().nullable(),
  relatedEntities: z.array(z.string()),
  thesis: z.string(),
  whyThisExpressesTheOpportunity: z.string(),
  directness: z.enum(["direct", "strong_proxy", "weak_proxy", "none"])
    .describe("How directly the expression gives causal exposure to the framed opportunity, not merely thematic similarity."),
  whatMustBeTrue: z.array(z.string()),
  searchTerms: z.array(z.string()),
  requiredMarketFeatures: z.array(z.string()),
  requiredRuleOrContractFeatures: z.array(z.string())
    .describe("Required market rules, listing details, resolution criteria, instrument specs, or contract terms that must be verified before selection."),
  keyRisks: z.array(z.string()),
  expectedTimeHorizon: z.enum(["minutes", "hours", "days", "weeks", "months", "year_plus", "unknown"]),
  priority: z.enum(["high", "medium", "low"]),
  confidence: z.number().min(0).max(1),
});

export const DiscardedTradeExpressionSchema = z.object({
  idea: z.string(),
  reasonDiscarded: z.string(),
});

export const NoTradeCaseSchema = z.object({
  shouldConsiderNoTrade: z.boolean(),
  reason: z.string().describe("Explain why no trade may be preferable despite the tweet containing a potentially interesting market signal."),
  whatWouldChangeThis: z.array(z.string()),
});

export const ExpressionFitAssessmentSchema = z.object({
  candidateId: z.string(),
  expressionId: z.string(),
  expressionRail: z.enum(["crypto", "pre_ipo", "prediction_market"]),
  venue: z.string(),
  fitStatus: z.enum(["validated", "rejected", "needs_more_info"])
    .describe("Use validated only when the real venue candidate semantically and contractually matches the intended expression."),
  intendedSide: z.string(),
  sideFit: z.enum(["correct", "opposite", "ambiguous", "unknown"]),
  directness: z.enum(["direct", "strong_proxy", "weak_proxy", "unrelated", "unknown"]),
  fitScore: z.number().min(0).max(1),
  semanticFitSummary: z.string(),
  ruleOrContractFitSummary: z.string()
    .describe("Summarize verified venue rules, contract terms, listing details, or instrument specs that support or block the fit."),
  basisRisks: z.array(z.string()),
  mismatchReasons: z.array(z.string()),
  requiredFollowUp: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const XSentimentEvidenceSchema = z.object({
  url: z.string().nullable(),
  authorName: z.string().nullable(),
  text: z.string().min(1),
  observedAt: z.string().nullable(),
  relevance: z.string(),
});

export const XSentimentAssessmentSchema = z.object({
  status: z.enum(["available", "insufficient_evidence"]),
  sourcesChecked: z.array(z.literal("x")),
  sentimentDirection: z.enum(["bullish", "bearish", "mixed", "neutral"]),
  attentionLevel: z.enum(["low", "medium", "high", "unclear"]),
  novelty: z.enum(["new", "already_widespread", "unclear"]),
  crowdingRisk: z.enum(["low", "medium", "high", "unclear"]),
  correctionRisk: z.enum(["low", "medium", "high", "unclear"]),
  summary: z.string(),
  evidence: z.array(XSentimentEvidenceSchema).max(10),
  limitations: z.array(z.string()),
});

export const TradeExpressionCandidateSchema = z.object({
  instrument: z.string(),
  venue: z.enum(["hyperliquid", "polymarket"]).nullable(),
  symbol: z.string().nullable(),
  instrumentType: z.enum(["spot", "perp", "pre_stock_perp", "prediction_market", "unknown"]).nullable(),
  venueQuery: z.string().nullable(),
  expression: z.enum(["long", "short", "pair", "basket", "market_check", "no_trade"]),
  thesis: z.string(),
  venueChecks: z.array(z.string()),
  currentMarketPriceOrOdds: z.string().nullable(),
  fairValueOrExpectedValue: z.string().nullable(),
  causalDirectness: z.number().min(0).max(1),
  liquidity: z.number().min(0).max(1),
  surprise: z.number().min(0).max(1),
  timing: z.number().min(0).max(1),
  crowdingRisk: z.number().min(0).max(1),
  downsideAsymmetry: z.number().min(0).max(1),
  evidenceQuality: z.number().min(0).max(1),
  expectedEdge: z.number().min(-1).max(1),
  tradableNow: z.boolean(),
  rejectionReason: z.string().nullable(),
  invalidation: z.array(z.string()),
  evidenceNeeded: z.array(z.string()),
});

export const RankedTradeExpressionCandidateSchema = z.object({
  rank: z.number().int().positive(),
  candidateId: z.string(),
  venue: z.enum(["hyperliquid", "polymarket"]),
  symbol: z.string(),
  side: z.enum(["long", "short", "buy_yes", "buy_no", "buy", "sell"]),
  expressionConfidence: z.number().min(0).max(1),
  thesisFit: z.number().min(0).max(1),
  causalDirectness: z.number().min(0).max(1),
  liquidity: z.number().min(0).max(1),
  venueConfirmation: z.number().min(0).max(1),
  priceOrOddsConfidence: z.number().min(0).max(1),
  timingFit: z.number().min(0).max(1),
  expectedEdge: z.number().min(-1).max(1),
  tradableNow: z.boolean(),
  reason: z.string(),
  invalidation: z.array(z.string()),
});

export const EvidenceInsufficiencySchema = z.object({
  score: z.number().min(0).max(1),
  requiredThreshold: z.number().min(0).max(1),
  failedDimensions: z.array(z.enum([
    "source_reliability",
    "primary_source_access",
    "entity_resolution",
    "market_discovery",
    "venue_confirmation",
    "price_or_odds",
    "liquidity",
    "causal_directness",
    "timing",
    "valuation_work",
    "risk_invalidation",
  ])).min(1),
  summary: z.string(),
  evidenceNeededToClear: z.array(z.string()).min(1),
});

export const TradeExpressionPlanSchema = z.object({
  signal: z.string(),
  coreInterpretation: z.string(),
  directAsset: z.string().nullable(),
  directAssetTradable: z.boolean(),
  evidenceConfidence: z.number().min(0).max(1).nullable(),
  marketDiscoveryConfidence: z.number().min(0).max(1).nullable(),
  tradeExpressionConfidence: z.number().min(0).max(1).nullable(),
  highestPurityExpression: z.string(),
  publicMarketReadThrough: z.enum(["none", "weak", "moderate", "strong"]),
  candidates: z.array(TradeExpressionCandidateSchema),
  rankedCandidates: z.array(RankedTradeExpressionCandidateSchema),
  candidateExpressions: z.array(CandidateTradeExpressionSchema),
  discardedExpressions: z.array(DiscardedTradeExpressionSchema),
  noTradeCase: NoTradeCaseSchema.nullable(),
  decision: z.enum([
    "route_to_market_router",
    "needs_market_check",
    "no_trade",
  ]),
  reason: z.string(),
  insufficiency: EvidenceInsufficiencySchema.nullable(),
  marketRouterInstructions: z.string().nullable(),
});

export const CassieActionStateSchema = z.enum([
  "no_trade",
  "needs_market_check",
  "insufficient_evidence",
  "trade_candidate",
  "route_to_market",
  "long_perp",
  "short_perp",
  "buy_yes",
  "buy_no",
  "create_ticket",
]);

export const AccountStateSchema = z.object({
  userId: z.string(),
  availableBalanceUsd: z.number().nonnegative(),
  openExposureUsd: z.number().nonnegative(),
  dailyLossUsd: z.number().nonnegative(),
  openOrdersUsd: z.number().nonnegative(),
});

export const TradeTicketSchema = z.object({
  ticketId: z.string(),
  runId: z.string().nullable().optional(),
  userId: z.string(),
  thesis: z.string(),
  venue: z.string(),
  instrument: z.string(),
  side: z.string(),
  sizeUsd: z.number().positive(),
  orderType: z.enum(["limit", "marketable_limit"]),
  venueData: TradeVenueDataSchema.optional(),
});

export const ExecutionJobSchema = z.object({
  jobId: z.string(),
  ticketId: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  failureReason: z.string().nullable(),
  executionResult: z
    .object({
      venueOrderId: z.string().nullable(),
      filledSizeUsd: z.number().nonnegative(),
      averagePrice: z.number().nonnegative().nullable(),
      raw: z.unknown().optional(),
    })
    .nullable(),
});

export const AuditEventSchema = z.object({
  eventId: z.string(),
  entityId: z.string(),
  entityType: z.enum(["mention", "run", "trade_ticket", "execution_job"]),
  eventType: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
  createdAt: z.string(),
});

export const ControlRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const SupervisorFinalResultSchema = z.object({
  responseType: z.enum(["analysis", "trade_ticket"]),
  actionState: CassieActionStateSchema,
  publicSummary: z.string(),
  runStatus: ControlRunStatusSchema.exclude(["queued", "running"]),
  ticketId: z.string().nullable(),
  warnings: z.array(z.string()),
});

export const RunStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const RunStepTypeSchema = z.enum([
  "intake",
  "preflight",
  "opportunity",
  "trade_expression",
  "market_candidates",
  "market_assessment",
  "market_quote",
  "x_sentiment",
  "market_selection",
  "ticket",
  "final",
]);

export const ControlRunSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  userCommand: z.string(),
  sourcePost: SourcePostSchema,
  status: ControlRunStatusSchema,
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RunStepSchema = z.object({
  stepId: z.string(),
  runId: z.string(),
  stepType: RunStepTypeSchema,
  status: RunStepStatusSchema,
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  promptName: z.string().nullable(),
  promptVersion: z.string().nullable(),
  thinkingTrace: z.string().nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type CassieIntent = z.infer<typeof CassieIntentSchema>;
export type SourcePost = z.infer<typeof SourcePostSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type Thesis = z.infer<typeof ThesisSchema>;
export type MarketCandidate = z.infer<typeof MarketCandidateSchema>;
export type OpportunityFrame = z.infer<typeof OpportunityFrameSchema>;
export type PolymarketMarketAssessment = z.infer<typeof PolymarketMarketAssessmentSchema>;
export type PolymarketQuote = z.infer<typeof PolymarketQuoteSchema>;
export type MarketSelection = z.infer<typeof MarketSelectionSchema>;
export type CandidateTradeExpression = z.infer<typeof CandidateTradeExpressionSchema>;
export type ExpressionFitAssessment = z.infer<typeof ExpressionFitAssessmentSchema>;
export type XSentimentAssessment = z.infer<typeof XSentimentAssessmentSchema>;
export type TradeExpressionCandidate = z.infer<typeof TradeExpressionCandidateSchema>;
export type TradeExpressionPlan = z.infer<typeof TradeExpressionPlanSchema>;
export type CassieActionState = z.infer<typeof CassieActionStateSchema>;
export type AccountState = z.infer<typeof AccountStateSchema>;
export type TradeTicket = z.infer<typeof TradeTicketSchema>;
export type ExecutionJob = z.infer<typeof ExecutionJobSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type ControlRunStatus = z.infer<typeof ControlRunStatusSchema>;
export type SupervisorFinalResult = z.infer<typeof SupervisorFinalResultSchema>;
export type RunStepStatus = z.infer<typeof RunStepStatusSchema>;
export type RunStepType = z.infer<typeof RunStepTypeSchema>;
export type ControlRun = z.infer<typeof ControlRunSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
