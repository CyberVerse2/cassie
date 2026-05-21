import { z } from "zod";

export const CassieIntentSchema = z.enum([
  "think",
  "critic",
  "trade",
  "countertrade",
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
  allowedAssets: z.array(z.string()),
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

export const ThesisSchema = z.object({
  claim: z.string(),
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
  relevance: z.number().min(0).max(1),
  notes: z.array(z.string()).nullable(),
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
    founderDossier: z.object({
      identifiedPeople: z.array(z.string()),
      evidenceSummary: z.string(),
      openQuestions: z.array(z.string()),
    }),
    smartEngagerSignal: z.object({
      quality: z.enum(["high", "medium", "low", "unknown"]),
      summary: z.string(),
      notableAccounts: z.array(z.string()),
    }),
    leadQuality: z.enum(["ignore", "watchlist", "research_lead", "soft_signal", "tradable_now"]),
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
});

export const CritiqueSchema = z.object({
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
  markPrice: z.number().positive().nullable().optional(),
  liquidityScore: z.number().min(0).max(1),
  spreadBps: z.number().nonnegative(),
  estimatedSlippageBps: z.number().nonnegative().default(0),
  minOrderSizeUsd: z.number().nonnegative().default(0),
  thesisFit: z.number().min(0).max(1),
  reason: z.string(),
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
  selectedMarket: MarketCandidateSchema.nullable(),
  rejectedCandidates: z.array(
    z.object({
      venue: z.string(),
      symbol: z.string(),
      reason: z.string(),
    }),
  ),
  noTradeReason: z.string().nullable(),
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

export const AccountStateSchema = z.object({
  userId: z.string(),
  availableBalanceUsd: z.number().nonnegative(),
  openExposureUsd: z.number().nonnegative(),
  dailyLossUsd: z.number().nonnegative(),
  openOrdersUsd: z.number().nonnegative(),
});

export const TradeTicketSchema = z.object({
  ticketId: z.string(),
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

export const StoredRunSchema = z.object({
  runId: z.string(),
  mentionId: z.string(),
  userId: z.string(),
  userCommand: z.string(),
  sourcePost: SourcePostSchema,
  responseType: z.enum(["analysis", "critique", "trade_ticket"]),
  result: z.unknown(),
  createdAt: z.string(),
});

export type CassieIntent = z.infer<typeof CassieIntentSchema>;
export type SourcePost = z.infer<typeof SourcePostSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type IntentResult = z.infer<typeof IntentResultSchema>;
export type Thesis = z.infer<typeof ThesisSchema>;
export type InverseThesis = z.infer<typeof InverseThesisSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;
export type Critique = z.infer<typeof CritiqueSchema>;
export type MarketCandidate = z.infer<typeof MarketCandidateSchema>;
export type MarketSelection = z.infer<typeof MarketSelectionSchema>;
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
export type AccountState = z.infer<typeof AccountStateSchema>;
export type TradeTicket = z.infer<typeof TradeTicketSchema>;
export type ExecutionJob = z.infer<typeof ExecutionJobSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type StoredRun = z.infer<typeof StoredRunSchema>;
