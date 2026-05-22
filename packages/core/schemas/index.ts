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

export const ResearchDispositionSchema = z.enum([
  "ignore",
  "research_lead",
  "soft_signal",
  "verified_non_tradeable",
  "needs_more_research",
  "needs_market_check",
  "trade_candidate",
  "block_trade",
  "no_trade",
]);

export const TradeabilityDispositionSchema = z.enum([
  "no_trade",
  "private_only",
  "watchlist_only",
  "needs_market_check",
  "prediction_market_candidate",
  "public_market_candidate",
  "crypto_market_candidate",
  "route_to_market_router",
  "block_trade",
]);

export const FinalRunDispositionSchema = z.enum([
  "answered",
  "critic_only",
  "watchlist_added",
  "trade_ticket_created",
  "trade_rejected",
  "no_trade",
  "needs_more_research",
]);

const LegacyResearchDispositionSchema = z.enum(["watchlist", "tradable_now"]);

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

export const SourceProfileSchema = z.object({
  handle: z.string(),
  displayName: z.string().nullable(),
  profileUrl: z.string().nullable(),
  bio: z.string().nullable(),
  bioLinks: z.array(z.string()),
  accountType: z.enum(["person", "builder", "company", "project", "media", "analyst", "trader", "anon", "parody", "unknown"]),
  verificationStatus: z.string().nullable(),
  followerCount: z.string().nullable(),
  followingCount: z.string().nullable(),
  accountAge: z.string().nullable(),
  locationSignals: z.array(z.string()),
  pinnedPost: z.string().nullable(),
  claimSpecificRelevance: z.number().min(0).max(1).optional(),
  profileEvidenceIds: z.array(z.string()).optional(),
  credibility: z.enum(["high", "medium", "low", "unknown"]),
  expertise: z.array(z.string()),
  selfClaims: z.array(z.string()),
  provenOutput: z.array(z.string()),
  trackRecord: z.string(),
  networkContext: z.string(),
  engagementQuality: z.enum(["high", "medium", "low", "unknown"]),
  recentRelevantActivity: z.array(z.string()),
  redFlags: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  lowDataReasons: z.array(z.string()),
  confidenceImpact: z.enum(["high", "medium", "low", "very_low", "none", "unknown"]),
  confidenceImpactReason: z.string(),
  confidence: z.number().min(0).max(1),
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

export const IntentResultSchema = z.object({
  intent: CassieIntentSchema,
  executionRequested: z.boolean(),
  counterThesis: z.boolean(),
  specificAsset: z.string().nullable(),
  specificVenue: z.string().nullable(),
  userSizeOverrideUsd: z.number().positive().nullable(),
  confidence: z.number().min(0).max(1),
});

export const SignalInterpretationSchema = z.object({
  signalType: z.enum([
    "explicit_trade",
    "news",
    "funding",
    "product_launch",
    "exploit_or_risk",
    "regulatory",
    "endorsement",
    "rumor",
    "social_momentum",
    "generic_opinion",
    "unknown",
  ]),
  containsExplicitThesis: z.boolean(),
  impliedTheses: z.array(z.string()),
  affectedEntities: z.array(z.string()),
  affectedSectors: z.array(z.string()),
  directTradability: z.enum(["direct", "indirect", "none", "unknown"]),
  suggestedResearchAngles: z.array(z.string()),
  leadQuality: z.union([ResearchDispositionSchema, LegacyResearchDispositionSchema]),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ThesisSchema = z.object({
  claim: z.string(),
  literalClaim: z.string().nullable().optional(),
  impliedResearchQuestion: z.string().nullable().optional(),
  impliedTradeThesis: z.string().nullable().optional(),
  sourceOrMetaSignal: z.string().nullable().optional(),
  hasExplicitTrade: z.boolean().optional(),
  hasConcreteResearchQuestion: z.boolean().optional(),
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

export const InverseThesisSchema = z.object({
  originalThesis: ThesisSchema,
  inverseClaim: z.string(),
  inverseDirection: DirectionSchema,
  mentionedAssets: z.array(z.string()),
  topics: z.array(z.string()),
  timeHorizon: TimeHorizonSchema,
  confidence: z.number().min(0).max(1),
});

export const ResearchWarningSchema = z.enum([
  "NO_PRIMARY_SOURCE",
  "ONLY_SOCIAL_SOURCES",
  "UNVERIFIED_SCREENSHOT",
  "OLD_NEWS_RECIRCULATED",
  "CLAIM_REFUTED",
  "CLAIM_PARTIALLY_SUPPORTED",
  "SOURCE_CONFLICT",
  "HIGH_SOCIAL_MOMENTUM",
  "POSSIBLE_COORDINATED_PUSH",
  "PROMOTIONAL_LANGUAGE",
  "TICKER_AMBIGUOUS",
  "LOW_EVIDENCE_QUALITY",
  "X_SEARCH_FAILED",
  "OPENAI_SEARCH_FAILED",
]);

const UnitScoreFromModelSchema = z.number().min(0).max(10).transform((value) =>
  value > 1 ? value / 10 : value
);

export const ResearchEvidenceSchema = z.object({
  sourceLane: z.enum(["openai_search", "x_search"]),
  sourceType: z.enum([
    "official",
    "regulatory",
    "company",
    "exchange",
    "news",
    "social",
    "blog",
    "unknown",
  ]),
  title: z.string().nullable(),
  url: z.string().nullable(),
  author: z.string().nullable(),
  publishedAt: z.string().nullable(),
  summary: z.string(),
  stance: z.enum(["supports", "refutes", "mixed", "unclear"]),
  reliability: z.enum(["high", "medium", "low"]),
  relevance: UnitScoreFromModelSchema,
  notes: z.array(z.string()).nullable(),
});

export const ResearchLaneSchema = z.enum(["web", "x"]);

export const ResearchGoalKindSchema = z.enum([
  "event_validation",
  "entity_resolution",
  "source_provenance",
  "social_momentum",
  "technical_reality",
  "market_pricing",
  "catalyst_timeline",
  "impact_materiality",
  "second_order_implications",
  "risk_assessment",
  "disconfirmation",
  "trade_expression",
]);

export const ResearchDecisionUseSchema = z.enum([
  "validate_or_kill_thesis",
  "decide_watchlist_priority",
  "estimate_materiality",
  "estimate_market_pricing",
  "identify_trade_expression",
  "identify_risk",
  "find_disconfirming_evidence",
  "route_to_deeper_research",
]);

export const ResearchGoalSchema = z.object({
  id: z.string(),
  kind: ResearchGoalKindSchema,
  question: z.string(),
  decisionUse: ResearchDecisionUseSchema,
  priority: UnitScoreFromModelSchema,
  mustResolve: z.boolean(),
  lanes: z.array(ResearchLaneSchema).min(1),
  evidenceNeeds: z.array(z.string()).min(1),
  disconfirmingQuestions: z.array(z.string()),
  resolutionCriteria: z.object({
    supportedIf: z.string(),
    contradictedIf: z.string(),
    unresolvedIf: z.string(),
  }),
  budget: z.object({
    maxQueries: z.number().int().min(0),
    maxResults: z.number().int().min(0),
    wave: z.number().int().min(0),
  }),
  stopWhen: z.array(z.string()),
});

export const ResearchQuerySpecSchema = z.object({
  id: z.string(),
  goalIds: z.array(z.string()).min(1),
  lane: ResearchLaneSchema,
  queryKind: z.enum([
    "exact_claim",
    "entity_event",
    "primary_source",
    "broad_context",
    "disconfirming",
    "social_provenance",
    "social_momentum",
    "market_timeseries",
    "code_docs",
    "regulatory_lookup",
  ]),
  query: z.string().optional(),
  queryIntent: z.string().optional(),
  entities: z.array(z.string()).optional(),
  requiredTerms: z.array(z.string()).optional(),
  optionalTerms: z.array(z.string()).optional(),
  excludeTerms: z.array(z.string()).optional(),
  priority: UnitScoreFromModelSchema,
  maxResults: z.number().int().min(1).max(100),
  expectedEvidence: z.string(),
  rationale: z.string(),
});

export const ResearchQueryBatchSchema = z.object({
  wave: z.number().int().min(0),
  name: z.string(),
  purpose: z.string(),
  queries: z.array(ResearchQuerySpecSchema),
});

export const ResearchQueryPlanSchema = z.object({
  version: z.literal("research-query-plan/v1"),
  normalizedClaim: z.string(),
  signalType: SignalInterpretationSchema.shape.signalType,
  mode: z.enum(["minimal_watchlist", "standard", "deep_dive", "crisis"]),
  assets: z.array(z.string()),
  topics: z.array(z.string()),
  sourceHandle: z.string().nullable(),
  sourceName: z.string().nullable(),
  scores: z.object({
    specificity: UnitScoreFromModelSchema,
    marketLinkage: UnitScoreFromModelSchema,
    sourceValue: UnitScoreFromModelSchema,
    urgency: UnitScoreFromModelSchema,
    risk: UnitScoreFromModelSchema,
    novelty: UnitScoreFromModelSchema,
    expectedValueOfResearch: UnitScoreFromModelSchema,
  }),
  goals: z.array(ResearchGoalSchema),
  queryBatches: z.array(ResearchQueryBatchSchema),
  synthesisContract: z.object({
    requiredGoalIds: z.array(z.string()),
    cannotConcludeIfUnresolved: z.array(z.string()),
  }),
});

export const SearchSourceTypeSchema = z.enum([
  "official",
  "regulatory",
  "company",
  "exchange",
  "filing",
  "court_doc",
  "news",
  "specialist_media",
  "blog",
  "github",
  "docs",
  "social",
  "security_researcher",
  "market_data",
  "onchain_data",
  "prediction_market",
  "aggregator",
  "unknown",
]);

export const QueryJobSchema = z.object({
  id: z.string(),
  runId: z.string(),
  wave: z.number().int().min(0),
  querySpecId: z.string(),
  goalIds: z.array(z.string()).min(1),
  lane: ResearchLaneSchema,
  provider: z.string(),
  query: z.string(),
  queryKind: ResearchQuerySpecSchema.shape.queryKind,
  priority: z.number().min(0).max(1),
  maxResults: z.number().int().min(1).max(100),
  mustExecuteAtomically: z.boolean(),
  expectedEvidence: z.string(),
  rationale: z.string(),
});

export const SearchResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  queryJobId: z.string(),
  queryId: z.string(),
  goalIds: z.array(z.string()).min(1),
  wave: z.number().int().min(0),
  lane: ResearchLaneSchema,
  provider: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  author: z.string().nullable(),
  sourceName: z.string().nullable(),
  sourceType: SearchSourceTypeSchema,
  publishedAt: z.string().nullable(),
  retrievedAt: z.string(),
  rawText: z.string().nullable(),
  snippet: z.string().nullable(),
  rank: z.number().int().nullable(),
  duplicateOf: z.string().nullable(),
  metadata: z.array(z.object({
    key: z.string(),
    value: z.string().nullable(),
  })),
});

export const EvidenceClaimSchema = z.object({
  id: z.string(),
  resultId: z.string(),
  queryJobId: z.string(),
  queryId: z.string(),
  goalIds: z.array(z.string()).min(1),
  wave: z.number().int().min(0),
  claimText: z.string(),
  normalizedClaim: z.string().nullable(),
  entities: z.array(z.string()),
  assets: z.array(z.string()),
  topics: z.array(z.string()),
  eventTime: z.string().nullable(),
  claimTimeRelation: z.enum(["before_signal", "same_time", "after_signal", "unclear"]),
  sourceType: SearchSourceTypeSchema,
  directness: z.enum(["primary", "direct_secondary", "indirect", "rumor", "context"]),
  reliability: z.enum(["high", "medium", "low", "unknown"]),
  extractionConfidence: z.number().min(0).max(1),
  quote: z.string().nullable(),
  quoteStartChar: z.number().int().nullable(),
  quoteEndChar: z.number().int().nullable(),
});

export const GoalEvidenceLinkSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  evidenceClaimId: z.string(),
  stance: z.enum(["supports", "contradicts", "qualifies", "context", "irrelevant"]),
  relevance: UnitScoreFromModelSchema,
  strength: UnitScoreFromModelSchema,
  reason: z.string(),
  satisfiesEvidenceNeeds: z.array(z.string()),
  redFlags: z.array(z.enum([
    "source_is_aggregator",
    "unverified_social",
    "promotional",
    "stale",
    "ambiguous_entity",
    "ambiguous_resolution",
    "duplicate",
    "low_directness",
    "possible_coordination",
    "paywalled_or_unverified",
  ])),
});

export const EvidenceLedgerSchema = z.object({
  searchResults: z.array(SearchResultSchema),
  evidenceClaims: z.array(EvidenceClaimSchema),
  goalEvidenceLinks: z.array(GoalEvidenceLinkSchema),
});

export const GoalResolutionSchema = z.object({
  goalId: z.string(),
  status: z.enum([
    "resolved_supported",
    "resolved_contradicted",
    "partially_resolved",
    "unresolved",
    "not_applicable",
  ]),
  confidence: z.number().min(0).max(1),
  supportingEvidenceIds: z.array(z.string()),
  contradictingEvidenceIds: z.array(z.string()),
  contextualEvidenceIds: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  summary: z.string(),
  synthesisImplication: z.string(),
});

export const ResearchContinuationDecisionSchema = z.object({
  action: z.enum([
    "stop_no_trade",
    "stop_research_lead",
    "stop_watchlist",
    "continue_planned",
    "continue_with_adaptive_queries",
    "escalate_crisis",
    "route_to_trade_expression",
  ]),
  reason: z.string(),
  resolvedGoalIds: z.array(z.string()),
  unresolvedBlockingGoalIds: z.array(z.string()),
  contradictedGoalIds: z.array(z.string()),
  allowedNextGoalIds: z.array(z.string()),
  maxAdditionalQueries: z.number().int().min(0).nullable(),
  adaptiveQueryInstructions: z.array(z.string()),
  blockedActions: z.array(z.string()),
});

export const AdaptiveQueryRequestSchema = z.object({
  requests: z.array(z.object({
    unresolvedGoalId: z.string(),
    evidenceGap: z.string(),
    whyExistingEvidenceInsufficient: z.string(),
    decisionImpact: z.enum([
      "could_change_no_trade_to_watchlist",
      "could_change_watchlist_to_trade_candidate",
      "could_block_trade",
      "could_change_trade_expression",
      "could_change_risk_level",
      "low_impact",
    ]),
    proposedQueries: z.array(z.object({
      lane: ResearchLaneSchema,
      queryKind: ResearchQuerySpecSchema.shape.queryKind,
      query: z.string().optional(),
      queryIntent: z.string().optional(),
      expectedEvidence: z.string(),
      maxResults: z.number().int().min(1).max(100),
      stopAfter: z.string().optional(),
      priority: UnitScoreFromModelSchema,
      rationale: z.string(),
    })).max(3),
    remainingBudgetJustification: z.string().optional(),
  })),
});

export const ResearchReportSchema = z.object({
  claim: z.string(),
  normalizedThesis: z.string(),
  stance: z.enum([
    "supported",
    "partially_supported",
    "refuted",
    "unverified",
    "unclear",
  ]),
  evidenceQuality: z.enum(["strong", "medium", "weak", "insufficient"]),
  socialContext: z.object({
    momentum: z.enum(["low", "medium", "high", "unknown"]),
    crowdingSignal: z.enum(["low", "medium", "high", "unknown"]),
    manipulationSignal: z.enum(["low", "medium", "high", "unknown"]),
    summary: z.string(),
  }),
  socialSignal: z.object({
    sourceCredibility: z.enum(["high", "medium", "low", "unknown"]),
    endorserReputation: z.string(),
    entityResolution: z.object({
      resolvedEntity: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low", "unknown"]),
      rationale: z.string(),
      unverifiedAssumptions: z.array(z.string()),
    }),
    personProjectDossier: z.object({
      identifiedPeople: z.array(z.string()),
      evidenceSummary: z.string(),
      openQuestions: z.array(z.string()),
    }),
    smartEngagerSignal: z.object({
      quality: z.enum(["high", "medium", "low", "unknown"]),
      summary: z.string(),
      notableAccounts: z.array(z.string()),
    }),
    leadQuality: z.union([ResearchDispositionSchema, LegacyResearchDispositionSchema]),
    nextResearchActions: z.array(z.string()),
  }),
  bullCase: z.array(z.string()),
  bearCase: z.array(z.string()),
  contradictions: z.array(z.string()),
  evidence: z.array(ResearchEvidenceSchema),
  warnings: z.array(ResearchWarningSchema),
  confidence: z.number().min(0).max(1),
  researchConclusion: z.enum([
    "claim_likely_true",
    "claim_plausible_but_unconfirmed",
    "claim_false_or_refuted",
    "claim_unclear",
    "insufficient_research",
  ]),
  recommendedResearchAction: z.enum([
    "proceed_to_market_router",
    "proceed_with_caution",
    "critic_only",
    "insufficient_research",
    "do_not_continue",
  ]),
  publicSummary: z.string(),
  fullResearchBrief: z.string(),
  blockedConclusions: z.array(z.string()).optional(),
  allowedConclusions: z.array(z.string()).optional(),
  requiredNextActions: z.array(z.string()).optional(),
});

export const CritiqueSchema = z.object({
  verdict: z.enum([
    "thesis_survives",
    "thesis_weakened",
    "thesis_contradicted",
    "not_enough_evidence",
    "trade_expression_weak",
    "market_discovery_missing",
  ]).optional(),
  strongestObjections: z.array(z.object({
    category: z.enum([
      "source",
      "entity_resolution",
      "evidence",
      "valuation",
      "pricing",
      "crowding",
      "liquidity",
      "causal_directness",
      "timing",
      "venue",
      "risk",
    ]),
    objection: z.string(),
    severity: z.number().min(0).max(1),
    evidenceIds: z.array(z.string()).default([]),
  })).optional(),
  whatWouldChangeMind: z.array(z.string()).optional(),
  blockedConclusions: z.array(z.string()).optional(),
  strongestObjection: z.string(),
  secondaryObjections: z.array(z.string()),
  thesisTradable: z.boolean(),
  fadeIsCleaner: z.boolean(),
  finalCritique: z.string(),
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
  venue: z.enum(["hyperliquid", "polymarket", "public_equity", "listed_options", "crypto_spot", "private_market", "other"]).nullable().optional(),
  symbol: z.string().nullable().optional(),
  instrumentType: z.enum(["spot", "perp", "pre_stock_perp", "prediction_market", "equity", "option", "private", "unknown"]).nullable().optional(),
  venueQuery: z.string().nullable().optional(),
  expression: z.enum(["long", "short", "pair", "basket", "market_check", "no_trade"]),
  thesis: z.string(),
  venueChecks: z.array(z.string()).optional(),
  currentMarketPriceOrOdds: z.string().nullable().optional(),
  fairValueOrExpectedValue: z.string().nullable().optional(),
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
  venue: z.string(),
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
  evidenceConfidence: z.number().min(0).max(1).optional(),
  marketDiscoveryConfidence: z.number().min(0).max(1).optional(),
  tradeExpressionConfidence: z.number().min(0).max(1).optional(),
  highestPurityExpression: z.string(),
  publicMarketReadThrough: z.enum(["none", "weak", "moderate", "strong"]),
  candidates: z.array(TradeExpressionCandidateSchema),
  rankedCandidates: z.array(RankedTradeExpressionCandidateSchema).optional(),
  decision: z.enum([
    "route_to_market_router",
    "needs_market_check",
    "no_trade",
  ]),
  reason: z.string(),
  insufficiency: EvidenceInsufficiencySchema.nullable().optional(),
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
  "watchlist",
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
  entityType: z.enum(["mention", "run", "research_report", "trade_ticket", "execution_job"]),
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
  responseType: z.enum(["analysis", "critique", "trade_decision", "trade_ticket"]),
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
  "intent",
  "signal",
  "thesis",
  "inverse_thesis",
  "research",
  "critique",
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
export type ResearchDisposition = z.infer<typeof ResearchDispositionSchema>;
export type TradeabilityDisposition = z.infer<typeof TradeabilityDispositionSchema>;
export type FinalRunDisposition = z.infer<typeof FinalRunDispositionSchema>;
export type SourcePost = z.infer<typeof SourcePostSchema>;
export type SourceProfile = z.infer<typeof SourceProfileSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type IntentResult = z.infer<typeof IntentResultSchema>;
export type SignalInterpretation = z.infer<typeof SignalInterpretationSchema>;
export type Thesis = z.infer<typeof ThesisSchema>;
export type InverseThesis = z.infer<typeof InverseThesisSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;
export type ResearchGoal = z.infer<typeof ResearchGoalSchema>;
export type ResearchQueryPlan = z.infer<typeof ResearchQueryPlanSchema>;
export type QueryJob = z.infer<typeof QueryJobSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;
export type GoalEvidenceLink = z.infer<typeof GoalEvidenceLinkSchema>;
export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;
export type GoalResolution = z.infer<typeof GoalResolutionSchema>;
export type ResearchContinuationDecision = z.infer<typeof ResearchContinuationDecisionSchema>;
export type AdaptiveQueryRequest = z.infer<typeof AdaptiveQueryRequestSchema>;
export type Critique = z.infer<typeof CritiqueSchema>;
export type MarketCandidate = z.infer<typeof MarketCandidateSchema>;
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
