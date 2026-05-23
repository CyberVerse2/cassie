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
  quotedPostText: z.string().nullable().optional(),
  linkedUrls: z.array(z.string()).optional(),
  mediaDescriptions: z.array(z.string()).optional(),
});

export const UserSettingsSchema = z.object({
  userId: z.string(),
  walletAddress: z.string().nullable().default(null),
  allowedVenues: z.array(z.string()),
  defaultTradeSizeUsd: z.number().positive(),
  maxTradeSizeUsd: z.number().positive(),
  maxDailyLossUsd: z.number().nonnegative(),
  minConfidence: z.number().min(0).max(1),
  maxSpreadBps: z.number().nonnegative(),
  maxSlippageBps: z.number().nonnegative().default(100),
  maxPositionUsd: z.number().positive().default(1_000),
  autoTradeEnabled: z.boolean(),
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
  conditionId: z.string().nullable().optional(),
  outcomeTokenId: z.string().nullable().optional(),
  yesOutcomeTokenId: z.string().nullable().optional(),
  noOutcomeTokenId: z.string().nullable().optional(),
  marketQuestion: z.string().nullable().optional(),
  marketSlug: z.string().nullable().optional(),
  outcome: z.enum(["yes", "no"]).nullable().optional(),
  yesPrice: z.number().positive().max(1).nullable().optional(),
  noPrice: z.number().positive().max(1).nullable().optional(),
  heldSidePrice: z.number().positive().max(1).nullable().optional(),
  volumeUsd: z.number().nonnegative().nullable().optional(),
  liquidityUsd: z.number().nonnegative().nullable().optional(),
  endDate: z.string().nullable().optional(),
  warnings: z.array(z.string()).optional(),
  markPrice: z.number().positive().nullable().optional(),
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
  signalVerificationRisk: z.enum(["low", "medium", "high", "unknown"]),
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
  decision: z.enum(["select_market", "no_selection"]).optional(),
  selectedMarket: MarketCandidateSchema.nullable(),
  selectedCandidateId: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  rankedCandidates: z.array(z.object({
    candidateId: z.string(),
    thesisFit: z.number().min(0).max(1),
    liquidityFit: z.number().min(0).max(1),
    payoffFit: z.number().min(0).max(1),
    reason: z.string(),
  })).optional(),
  rejectedCandidates: z.array(
    z.object({
      venue: z.string(),
      symbol: z.string(),
      reason: z.string(),
    }),
  ),
  noTradeReason: z.string().nullable(),
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
  decision: z.enum([
    "route_to_market_router",
    "needs_market_check",
    "no_trade",
  ]),
  reason: z.string(),
  insufficiency: EvidenceInsufficiencySchema.nullable(),
  marketRouterInstructions: z.string().nullable(),
});

export const RiskDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    adjustedSizeUsd: z.number().positive(),
  }),
  z.object({
    decision: z.literal("require_approval"),
    reason: z.string(),
  }),
  z.object({
    decision: z.literal("reject"),
    reason: z.string(),
  }),
  z.object({
    decision: z.literal("create_ticket_only"),
    reason: z.string(),
  }),
]);

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
  "block_trade",
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
  riskDecision: RiskDecisionSchema,
  approvalState: z.enum(["not_required", "pending", "approved", "rejected"]),
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
  "awaiting_approval",
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
  "opportunity",
  "trade_expression",
  "market_candidates",
  "market_assessment",
  "market_quote",
  "market_selection",
  "risk",
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
export type TradeExpressionCandidate = z.infer<typeof TradeExpressionCandidateSchema>;
export type TradeExpressionPlan = z.infer<typeof TradeExpressionPlanSchema>;
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
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
