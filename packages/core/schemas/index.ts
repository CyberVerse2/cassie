import { z } from "zod";

export const CassieIntentSchema = z.enum([
  "critic",
  "trade",
  "countertrade",
  "watch",
]);

export const CassieCommandIntentSchema = z.enum([
  "not_a_command",
  ...CassieIntentSchema.options,
]);

export const CassieCommandClassificationSchema = z.object({
  intent: CassieCommandIntentSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const SourceModeSchema = z.enum(["normal", "breaking_news"]);

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
  // Image URLs from the post (pbs.twimg.com). Optional: older persisted runs
  // predate this field.
  mediaUrls: z.array(z.string()).optional(),
});

export const UserProfileSchema = z.object({
  name: z.string().min(1),
  handle: z.string().min(1),
  avatarUrl: z.string().nullable(),
});

export const UserSettingsSchema = z.object({
  userId: z.string(),
  privyUserId: z.string().nullable().default(null),
  privyWalletId: z.string().nullable().default(null),
  walletAddress: z.string().nullable().default(null),
  profile: UserProfileSchema,
  x: z
    .object({
      userId: z.string().min(1).nullable(),
      username: z.string().min(1).nullable(),
    })
    .nullable()
    .optional(),
  defaultTradeSizeUsd: z.number().positive(),
  telegram: z
    .object({
      chatId: z.string().min(1),
      username: z.string().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      connectedAt: z.string(),
      lastMessageAt: z.string(),
    })
    .nullable()
    .optional(),
  // One-time starter USDC sent from the treasury so new users can trade
  // before depositing. Written before the transfer (as a claim lock) and
  // stamped with the transfer id once it confirms.
  promoGrant: z
    .object({
      amountUsd: z.number(),
      transferId: z.string().nullable(),
      chain: z.string(),
      grantedAt: z.string(),
    })
    .nullable()
    .optional(),
});

export const ThesisSchema = z.object({
  claim: z.string(),
  literalClaim: z.string().nullable().optional(),
  impliedTradeThesis: z.string().nullable().optional(),
  sourceOrMetaSignal: z.string().nullable().optional(),
  hasExplicitTrade: z.boolean().optional(),
  hasTradableImplication: z.boolean().optional(),
  thesisStrength: z
    .enum(["none", "weak_inferred", "moderate_inferred", "explicit"])
    .optional(),
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
  resolutionRules: z.string().nullable().optional(),
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

export const SourceContextDiscoverySchema = z.object({
  summary: z.string(),
  claims: z.array(z.string()),
  entities: z.array(z.string()),
  assets: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const OpportunityFrameSchema = z.object({
  literalClaim: z.string(),
  opportunity: z.string(),
  marketImplication: z.string(),
  userIntent: CassieIntentSchema,
  affectedEntities: z.array(z.string()),
  affectedAssets: z.array(z.string()),
  expressionFamilies: z.array(z.string()),
  signalVerificationRisk: z
    .enum(["low", "medium", "high", "unknown"])
    .describe(
      "The risk that the source claim is false, misleading, stale, unverifiable, or missing critical context.",
    ),
  shouldVerifyTruthBeforeTrading: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export const SourceModeClassificationSchema = z.object({
  sourceMode: SourceModeSchema,
  userIntent: CassieIntentSchema,
  headlineThesis: z.string(),
  affectedEntities: z.array(z.string()),
  urgency: z.enum(["minutes", "hours", "days", "none"]),
  verificationNeed: z.enum(["low", "medium", "high"]),
  reason: z.string(),
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
  leverage: z.number().int().positive().optional(),
  notionalSizeUsd: z.number().positive().optional(),
});

export const MarketSelectionSchema = z.object({
  decision: z.enum(["select_market", "no_selection"]),
  selectedMarket: MarketCandidateSchema.nullable(),
  selectedCandidateId: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  rankedCandidates: z.array(
    z.object({
      candidateId: z.string(),
      thesisFit: z.number().min(0).max(1),
      liquidityFit: z.number().min(0).max(1),
      payoffFit: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
  rejectedCandidates: z.array(
    z.object({
      venue: z.string(),
      symbol: z.string(),
      reason: z.string(),
    }),
  ),
  noTradeReason: z.string().nullable(),
});

export const ExpressionRailSchema = z.enum([
  "crypto",
  "public_equity",
  "etf",
  "commodity",
  "fx",
  "rates",
  "bonds_credit",
  "futures",
  "options_volatility",
  "indices",
  "pre_ipo",
  "prediction_market",
  "onchain_defi_yield",
  "multi_leg",
  "other",
  "no_trade",
]);

export const TradableExpressionRailSchema = ExpressionRailSchema.exclude([
  "no_trade",
]);

export const CandidateTradeExpressionSchema = z.object({
  expressionId: z.string(),
  expressionRail: ExpressionRailSchema,
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
  thesis: z.string(),
  directness: z
    .enum(["direct", "strong_proxy", "weak_proxy", "none"])
    .describe(
      "How directly the expression gives causal exposure to the framed opportunity, not merely thematic similarity.",
    ),
  searchTerms: z.array(z.string()),
  requiredMarketFeatures: z.array(z.string()),
  requiredRuleOrContractFeatures: z
    .array(z.string())
    .describe(
      "Required market rules, listing details, resolution criteria, instrument specs, or contract terms that must be verified before selection.",
    ),
  expectedTimeHorizon: z.enum([
    "minutes",
    "hours",
    "days",
    "weeks",
    "months",
    "year_plus",
    "unknown",
  ]),
  priority: z.enum(["high", "medium", "low"]),
  confidence: z.number().min(0).max(1),
});

export const DiscardedTradeExpressionSchema = z.object({
  idea: z.string(),
  reasonDiscarded: z.string(),
});

export const NoTradeCaseSchema = z.object({
  shouldConsiderNoTrade: z.boolean(),
  reason: z
    .string()
    .describe(
      "Explain why no configured venue market was found for the thesis, or why venue discovery should stop because no searchable market expression remains.",
    ),
  whatWouldChangeThis: z.array(z.string()),
});

const ExpressionFitAssessmentBaseSchema = z.object({
  candidateId: z.string(),
  expressionId: z.string(),
  expressionRail: TradableExpressionRailSchema,
  venue: z.string(),
  intendedSide: z.string(),
  sideFit: z.enum(["correct", "opposite", "ambiguous", "unknown"]),
  directness: z.enum([
    "direct",
    "strong_proxy",
    "weak_proxy",
    "unrelated",
    "unknown",
  ]),
  semanticFitSummary: z.string(),
  ruleOrContractFitSummary: z
    .string()
    .describe(
      "Summarize the venue details used to map the candidate. Do not reject solely because secondary documentation is missing when the venue listing clearly maps to the intended expression.",
    ),
  basisRisks: z.array(z.string()),
  mismatchReasons: z.array(z.string()),
  requiredFollowUp: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const ExpressionFitAssessmentSchema =
  ExpressionFitAssessmentBaseSchema.extend({
    fitStatus: z
      .enum(["validated", "rejected"])
      .describe(
        "Use validated when the real venue candidate matches the intended expression; use rejected when it does not.",
      ),
    fitScore: z.number().min(0).max(1),
  });

const EvidenceGapDimensionSchema = z.enum([
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
]);

export const EvidenceInsufficiencySchema = z.object({
  score: z.number().min(0).max(1),
  requiredThreshold: z.number().min(0).max(1),
  failedDimensions: z.array(EvidenceGapDimensionSchema).min(1),
  summary: z.string(),
  evidenceNeededToClear: z.array(z.string()).min(1),
});

export const MarketDiscoveryPlanSchema = z.object({
  status: z.enum(["not_needed", "needed", "completed", "blocked"]),
  venues: z.array(z.enum(["hyperliquid", "polymarket"])),
  missing: z.array(EvidenceGapDimensionSchema),
  instructions: z.string().nullable(),
  queries: z.array(
    z.object({
      expressionId: z.string(),
      terms: z.array(z.string()),
    }),
  ),
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
  marketDiscovery: MarketDiscoveryPlanSchema.nullable(),
});

export const OpportunityTradePlanSchema = z.object({
  opportunityFrame: OpportunityFrameSchema,
  tradeExpression: TradeExpressionPlanSchema,
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

export const WalletFundingBalanceSchema = z.object({
  userId: z.string(),
  walletBalanceUsd: z.number().nonnegative(),
  reservedUsd: z.number().nonnegative(),
  spendableUsd: z.number().nonnegative(),
  updatedAt: z.string(),
});

export const PortfolioBalanceSnapshotSchema = z.object({
  snapshotId: z.string(),
  userId: z.string(),
  at: z.string(),
  valueUsd: z.number().nonnegative(),
  walletBalanceUsd: z.number().nonnegative(),
  unrealizedPnlUsd: z.number(),
});

export const UserAccountSchema = z.object({
  userId: z.string(),
  privyUserId: z.string().nullable(),
  privyWalletId: z.string().nullable(),
  walletAddress: z.string().nullable(),
  defaultTradeSizeUsd: z.number().positive(),
  telegram: UserSettingsSchema.shape.telegram,
  balance: WalletFundingBalanceSchema.nullable(),
});

export const WalletSpendLedgerEntryTypeSchema = z.enum([
  "trade_reserve",
  "trade_prefund",
  "trade_release",
  "trade_spend",
  "deposit_credit",
  "refund_credit",
  "sweep_to_gateway",
  "gateway_mint",
]);

export const WalletSpendLedgerEntrySchema = z.object({
  entryId: z.string(),
  userId: z.string(),
  type: WalletSpendLedgerEntryTypeSchema,
  amountUsd: z.number().nonnegative(),
  ticketId: z.string().nullable(),
  executionJobId: z.string().nullable(),
  chain: z.string().nullable().optional(),
  txHash: z.string().nullable().optional(),
  logIndex: z.number().int().nullable().optional(),
  circleTransferId: z.string().nullable().optional(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
});

export const UserDepositAddressSchema = z.object({
  userId: z.string(),
  walletSetId: z.string(),
  circleWalletId: z.string(),
  evmAddress: z.string(),
  createdAt: z.string(),
});

export const ChainSchema = z.enum([
  "arc",
  "base",
  "arbitrum",
  "ethereum",
  "optimism",
  "polygon",
  "avalanche",
]);

export const ExecutionFundingSourceSchema = z.object({
  type: z.literal("cassie_treasury"),
  userId: z.string(),
  treasuryWalletAddress: z.string(),
  prefundTransferId: z.string(),
  prefundTransferStatus: z.enum(["pending", "succeeded", "rejected", "failed"]),
  amountUsd: z.number().positive(),
  chain: ChainSchema.optional(),
  venueChain: ChainSchema.optional(),
});

export const TradeExitPlanSchema = z.object({
  takeProfitPct: z.number().positive().default(10),
  stopLossPct: z.number().positive().default(5),
  maxHoldDays: z.number().int().positive().default(7),
  reviewCadence: z.literal("daily").default("daily"),
  thesis: z.string().min(1),
  invalidationSignals: z.array(z.string().min(1)),
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
  exitPlan: TradeExitPlanSchema,
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
      filledBaseSize: z.number().nonnegative().nullable(),
      filledSizeUsd: z.number().nonnegative(),
      collateralUsedUsd: z.number().nonnegative().optional(),
      averagePrice: z.number().nonnegative().nullable(),
      raw: z.unknown().optional(),
    })
    .nullable(),
});

export const PositionStatusSchema = z.enum([
  "open",
  "closing",
  "closed",
  "close_failed",
]);
export const PositionReviewStatusSchema = z.enum(["succeeded", "failed"]);
export const ExitSignalSchema = z.enum([
  "none",
  "take_profit",
  "stop_loss",
  "max_hold",
  "thesis_invalidated",
]);

export const PositionSchema = z.object({
  positionId: z.string(),
  userId: z.string(),
  ticketId: z.string(),
  executionJobId: z.string(),
  venue: z.string(),
  instrument: z.string(),
  side: z.string(),
  status: PositionStatusSchema,
  entrySizeUsd: z.number().positive(),
  filledBaseSize: z.number().positive().nullable(),
  filledSizeUsd: z.number().positive(),
  entryPrice: z.number().positive().nullable(),
  currentMarkPrice: z.number().positive().nullable(),
  currentValueUsd: z.number().nonnegative(),
  unrealizedPnlUsd: z.number(),
  unrealizedPnlPct: z.number(),
  exitPlan: TradeExitPlanSchema,
  openedAt: z.string(),
  updatedAt: z.string(),
  lastMarkedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  closeExecutionJobId: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const PositionReviewSchema = z.object({
  reviewId: z.string(),
  positionId: z.string(),
  userId: z.string(),
  reviewedAt: z.string(),
  status: PositionReviewStatusSchema,
  markPrice: z.number().positive().nullable(),
  currentValueUsd: z.number().nonnegative().nullable(),
  unrealizedPnlUsd: z.number().nullable(),
  unrealizedPnlPct: z.number().nullable(),
  exitSignal: ExitSignalSchema,
  summary: z.string(),
  failureReason: z.string().nullable(),
});

export const AuditEventSchema = z.object({
  eventId: z.string(),
  entityId: z.string(),
  entityType: z.enum([
    "mention",
    "run",
    "trade_ticket",
    "execution_job",
    "position",
    "user",
  ]),
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
  "context_discovery",
  "opportunity",
  "trade_expression",
  "market_candidates",
  "market_assessment",
  "market_quote",
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
export type CassieCommandClassification = z.infer<
  typeof CassieCommandClassificationSchema
>;
export type SourceMode = z.infer<typeof SourceModeSchema>;
export type SourcePost = z.infer<typeof SourcePostSchema>;
export type TelegramConnection = NonNullable<
  z.infer<typeof UserSettingsSchema>["telegram"]
>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type UserAccount = z.infer<typeof UserAccountSchema>;
export type Thesis = z.infer<typeof ThesisSchema>;
export type MarketCandidate = z.infer<typeof MarketCandidateSchema>;
export type OpportunityFrame = z.infer<typeof OpportunityFrameSchema>;
export type OpportunityTradePlan = z.infer<typeof OpportunityTradePlanSchema>;
export type SourceModeClassification = z.infer<
  typeof SourceModeClassificationSchema
>;
export type PolymarketMarketAssessment = z.infer<
  typeof PolymarketMarketAssessmentSchema
>;
export type PolymarketQuote = z.infer<typeof PolymarketQuoteSchema>;
export type MarketSelection = z.infer<typeof MarketSelectionSchema>;
export type ExpressionRail = z.infer<typeof ExpressionRailSchema>;
export type TradableExpressionRail = z.infer<
  typeof TradableExpressionRailSchema
>;
export type CandidateTradeExpression = z.infer<
  typeof CandidateTradeExpressionSchema
>;
export type ExpressionFitAssessment = z.infer<
  typeof ExpressionFitAssessmentSchema
>;
export type TradeExpressionPlan = z.infer<typeof TradeExpressionPlanSchema>;
export type CassieActionState = z.infer<typeof CassieActionStateSchema>;

export type WalletFundingBalance = z.infer<typeof WalletFundingBalanceSchema>;
export type PortfolioBalanceSnapshot = z.infer<
  typeof PortfolioBalanceSnapshotSchema
>;
export type WalletSpendLedgerEntry = z.infer<
  typeof WalletSpendLedgerEntrySchema
>;
export type UserDepositAddress = z.infer<typeof UserDepositAddressSchema>;
export type Chain = z.infer<typeof ChainSchema>;
export type ExecutionFundingSource = z.infer<
  typeof ExecutionFundingSourceSchema
>;
export type TradeExitPlan = z.infer<typeof TradeExitPlanSchema>;
export type TradeTicket = z.infer<typeof TradeTicketSchema>;
export type ExecutionJob = z.infer<typeof ExecutionJobSchema>;
export type PositionStatus = z.infer<typeof PositionStatusSchema>;
export type PositionReviewStatus = z.infer<typeof PositionReviewStatusSchema>;
export type ExitSignal = z.infer<typeof ExitSignalSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type PositionReview = z.infer<typeof PositionReviewSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type ControlRunStatus = z.infer<typeof ControlRunStatusSchema>;
export type SupervisorFinalResult = z.infer<typeof SupervisorFinalResultSchema>;
export type SourceContextDiscovery = z.infer<
  typeof SourceContextDiscoverySchema
>;
export type RunStepStatus = z.infer<typeof RunStepStatusSchema>;
export type RunStepType = z.infer<typeof RunStepTypeSchema>;
export type ControlRun = z.infer<typeof ControlRunSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
