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
  allowedVenues: z.array(z.string()),
  allowedAssets: z.array(z.string()),
  defaultTradeSizeUsd: z.number().positive(),
  maxTradeSizeUsd: z.number().positive(),
  maxDailyLossUsd: z.number().nonnegative(),
  minConfidence: z.number().min(0).max(1),
  maxSpreadBps: z.number().nonnegative(),
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
  title: z.string().optional(),
  url: z.string().optional(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  summary: z.string(),
  stance: z.enum(["supports", "refutes", "mixed", "unclear"]),
  reliability: z.enum(["high", "medium", "low"]),
  relevance: z.number().min(0).max(1),
  notes: z.array(z.string()).optional(),
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
  liquidityScore: z.number().min(0).max(1),
  spreadBps: z.number().nonnegative(),
  thesisFit: z.number().min(0).max(1),
  reason: z.string(),
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

export const TradeTicketSchema = z.object({
  ticketId: z.string(),
  userId: z.string(),
  thesis: z.string(),
  venue: z.string(),
  instrument: z.string(),
  side: z.string(),
  sizeUsd: z.number().positive(),
  orderType: z.enum(["limit", "marketable_limit"]),
  riskDecision: RiskDecisionSchema,
  approvalState: z.enum(["not_required", "pending", "rejected"]),
});

export type CassieIntent = z.infer<typeof CassieIntentSchema>;
export type SourcePost = z.infer<typeof SourcePostSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type IntentResult = z.infer<typeof IntentResultSchema>;
export type Thesis = z.infer<typeof ThesisSchema>;
export type InverseThesis = z.infer<typeof InverseThesisSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type Critique = z.infer<typeof CritiqueSchema>;
export type MarketCandidate = z.infer<typeof MarketCandidateSchema>;
export type MarketSelection = z.infer<typeof MarketSelectionSchema>;
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
export type TradeTicket = z.infer<typeof TradeTicketSchema>;
