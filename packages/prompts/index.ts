import type { ModelMessage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { ModelTier, StructuredToolConfig } from "../ai/client.ts";
import {
  ExpressionFitAssessmentSchema,
  ExpressionRailSchema,
  MarketSelectionSchema,
  OpportunityFrameSchema,
  SourceModeClassificationSchema,
  TradeExpressionPlanSchema,
  TradeExitPlanSchema,
  type ExpressionFitAssessment,
  type MarketCandidate,
  type MarketSelection,
  type OpportunityFrame,
  type SourcePost,
  type SourceModeClassification,
  type Thesis,
  type TradeExpressionPlan,
} from "../core/schemas/index.ts";

const PROMPT_VERSION = "2026-05-31";

const ALLOWED_EXPRESSION_RAILS = ExpressionRailSchema.options;
const CONFIGURED_VENUE_CAPABILITIES = {
  hyperliquid: [
    "spot/perp/synthetic markets listed in live Hyperliquid metadata",
    "Hyperliquid HIP-3 pre-stock/private-company valuation perps when listed",
    "tokenized commodity, FX, index, equity, ETF, or other synthetic exposures only when listed in live metadata",
  ],
  polymarket: ["prediction markets with explicit resolution rules"],
};
const UNSUPPORTED_DIRECT_EXECUTION_RAILS = [
  "public equities or ETFs not listed on Hyperliquid",
  "TradFi futures not listed on Hyperliquid",
  "options and volatility instruments",
  "FX, rates, bonds, credit, and indices not listed on Hyperliquid",
  "onchain DeFi yield, staking, lending, LP, or vault strategies",
  "multi-leg, baskets, spreads, and hedge pairs as atomic executions",
];

export const PolymarketDiscoveryQueryPlanSchema = z.object({
  queries: z.array(z.string().min(2)).max(8),
});

export const PolymarketSearchResultSelectionSchema = z.object({
  selectedMarketSlugs: z.array(z.string().min(1)).max(25),
});

export const FastTicketPlanSchema = z.object({
  sourceMode: SourceModeClassificationSchema,
  opportunityFrame: OpportunityFrameSchema,
  tradeExpression: TradeExpressionPlanSchema,
  exitPlan: TradeExitPlanSchema,
  publicSummary: z.string(),
});

export type CassiePromptSpec<T> = {
  name: string;
  version: string;
  system: string;
  messages: ModelMessage[];
  outputSchema: z.ZodType<T>;
  tier?: ModelTier;
  providerOptions?: ProviderOptions;
  tools?: StructuredToolConfig;
};

const UNIVERSAL_SYSTEM_PROMPT = `You are Cassie, a governed tagged-tweet trading research agent.

Role:
- Separate source claim, market implication, abstract expression, venue fit, and ticket decision.
- Consider all asset classes: crypto, public equities, ETFs, commodities, FX, rates, bonds/credit, futures, options/volatility, indices, private/pre-IPO, prediction markets, onchain DeFi/yield, baskets/pairs/multi-leg, and other/unknown.
- Only configured venues can produce executable candidates: Hyperliquid live spot/perp/synthetic/pre-stock markets and Polymarket prediction markets.
- Identify unsupported clean expressions, but do not mark them executable unless a configured venue lists a real matching market.
- Preserve user intent even when the correct output is no-trade.
- Do not invent tickers, markets, prices, quotes, liquidity, probabilities, listings, funding rates, or contract rules.
- Keep private reasoning private and return concise, auditable structured fields.`;

const WEB_SEARCH_CAPABILITY_PROMPT = `Web search is available in this stage. Use it when the source claim is time-sensitive, externally verifiable, or materially affects whether the opportunity is real. One independent corroborating secondary report is enough to treat the source claim as confirmed for opportunity-framing purposes; stop truth-verification search at that point and move on to market implication. Do not invent facts when search results are absent or inconclusive; surface what remains unverified.`;

const PREDICTION_MARKET_ROUTING_RULES = `Prediction-market routing rule:
- Use prediction-market expressions when the thesis resolves to yes or no by a specific date with explicit or discoverable resolution criteria.
- Use the relevant direct asset-class expression for continuous direction, magnitude, valuation, structural, or untimed theses; it becomes executable only when a configured venue lists a matching market.
- When a source states both a binary catalyst and a price outcome, treat the prediction market as additive to the price expression, not a replacement.
- Cheap odds are not a fit defect. Evaluate contract match, side, deadline, rules, liquidity, and quote availability separately from whether market consensus agrees.`;

function sourceForPrompt(sourcePost: SourcePost) {
  return {
    text: sourcePost.text,
    author: sourcePost.authorHandle,
  };
}

function userPayloadMessage(payload: unknown): ModelMessage {
  return {
    role: "user",
    content: JSON.stringify(payload, null, 2),
  };
}

function makePromptSpec<T>(input: {
  name: string;
  stage: string;
  payload: unknown;
  outputSchema: z.ZodType<T>;
  tier?: ModelTier;
  providerOptions?: ProviderOptions;
  tools?: StructuredToolConfig;
}): CassiePromptSpec<T> {
  const capabilityPrompt = input.tools?.webSearch
    ? `\n\n${WEB_SEARCH_CAPABILITY_PROMPT}`
    : "";

  return {
    name: input.name,
    version: PROMPT_VERSION,
    system: `${UNIVERSAL_SYSTEM_PROMPT}${capabilityPrompt}

${input.stage}`,
    messages: [userPayloadMessage(input.payload)],
    outputSchema: input.outputSchema,
    tier: input.tier,
    providerOptions: input.providerOptions,
    tools: input.tools,
  };
}

export function renderPromptSpec(spec: CassiePromptSpec<unknown>): string {
  return [
    spec.system,
    ...spec.messages.map((message) => {
      const content = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content, null, 2);
      return `Input:\n${content}`;
    }),
  ].join("\n\n");
}

export function structuredPromptInput<T>(spec: CassiePromptSpec<T>) {
  return {
    name: spec.name,
    schema: spec.outputSchema,
    prompt: renderPromptSpec(spec),
    system: spec.system,
    messages: spec.messages,
    tier: spec.tier,
    providerOptions: spec.providerOptions,
    tools: spec.tools,
  };
}

export function marketSelectionPrompt(input: {
  thesis: Thesis;
  candidates: unknown[];
  tradeExpression?: unknown;
  fitAssessments?: unknown[];
  quotes?: unknown[];
}): string {
  return renderPromptSpec(marketSelectionPromptSpec(input));
}

export function marketSelectionPromptSpec(input: {
  thesis: Thesis;
  candidates: unknown[];
  tradeExpression?: unknown;
  fitAssessments?: unknown[];
  quotes?: unknown[];
}): CassiePromptSpec<MarketSelection> {
  return makePromptSpec({
    name: "cassie_market_selection",
    tier: "cheap",
    outputSchema: MarketSelectionSchema,
    payload: marketSelectionPayload(input),
    stage: `Tool name: rank_expressions
Prompt version: ${PROMPT_VERSION}

Purpose:
Rank real venue candidates and select the best grounded expression.

Role:
Final market ranker. Select from supplied real venue candidates only; do not verify news, search venues, or create tickets.

Rules:
- This tool is atomic: it selects a market from already-supplied venue candidates. It does not decide whether the overall thesis is true, whether evidence is sufficient to trade, or whether the run should be no-trade.
- Rank only real venue candidates supplied in the input.
- Treat upstream fitAssessments as authoritative for semantic and contract validity. Do not re-litigate source truth, thesis quality, timing, correction risk, or whether a candidate should have been validated.
- If the thesis is a date-bounded yes/no event and a validated prediction-market candidate matches the side, deadline, and resolution rules, it is usually the highest-purity expression.
- If the thesis is a continuous price, magnitude, valuation, structural, or untimed claim, do not select a prediction market merely because it is adjacent to the topic.
- If both a binary catalyst and price outcome are validated, rank the cleaner expression for the user's requested trade while preserving the other as a legitimate alternative in rejectedCandidates only if it is not selected.
- If any supplied candidate has a validated fit assessment and matching quote, decision must be select_market and selectedMarket must be one of those validated candidates.
- Do not select rejected candidates or candidates without a matching quote.
- Do not select a weak proxy if a direct expression exists.
- Prefer Hyperliquid perps over Hyperliquid spot for direct asset price exposure; use spot only when no validated quoted perp candidate exists for that expression.
- Return no_selection only when the supplied candidates contain no validated candidate with a matching quote.
- Use selectedMarket only for a real validated candidate.
- This tool only ranks markets; the supervisor creates the ticket after selectedMarket is set.

When uncertain:
- If candidate identity, validated fit, or quote linkage is missing, use no_selection or reject the candidate with the concrete missing field.
- Do not replace a failed candidate with an unsupplied adjacent rail.

Examples:
- Thesis: "Fed cuts rates by the June FOMC meeting"; candidates include a validated Polymarket contract with June deadline and a quoted TLT ETF proxy. Select the prediction market because it is the highest-purity date-bounded expression.
- Thesis: "Oil should rally if Iran supply is disrupted"; candidates include a validated oil perp and an adjacent "Iran deal by Friday" market. Select the oil expression when the user wants price exposure; keep the event market only if it is separately validated as an alternative.
- Thesis: "SUI activity should rise after free transfers"; candidates include a quoted validated SUI perp and a thematically related L1 prediction market. Select the SUI perp; reject the weak proxy.

Before returning, verify internally:
- decision, selectedMarket, selectedCandidateId, rankedCandidates, rejectedCandidates, and noTradeReason are mutually consistent.
- selectedMarket is one of the supplied candidates and has both validated fit and a matching quote.
- rejectedCandidates never includes the selected candidate.
- no_selection is used only when no supplied candidate has both validated fit and a matching quote.
- Prediction-market selection follows side, deadline, and resolution-rule fit rather than odds attractiveness.

${PREDICTION_MARKET_ROUTING_RULES}`,
  });
}

function marketSelectionPayload(input: {
  thesis: Thesis;
  candidates: unknown[];
  tradeExpression?: unknown;
  fitAssessments?: unknown[];
  quotes?: unknown[];
}) {
  return {
    thesis: input.thesis,
    tradeExpression: rankFocusedTradeExpression(input.tradeExpression),
    candidates: input.candidates,
    fitAssessments: input.fitAssessments ?? [],
    quotes: input.quotes ?? [],
  };
}

function rankFocusedTradeExpression(value: unknown) {
  const tradeExpression = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<TradeExpressionPlan>
    : null;
  if (!tradeExpression) return value ?? null;

  return {
    coreInterpretation: tradeExpression.coreInterpretation,
    directAsset: tradeExpression.directAsset,
    tradeExpressionConfidence: tradeExpression.tradeExpressionConfidence,
    highestPurityExpression: tradeExpression.highestPurityExpression,
    decision: tradeExpression.decision,
    marketRouterInstructions: tradeExpression.marketRouterInstructions,
    abstractExpressions: (tradeExpression.candidateExpressions ?? []).map((candidate) => ({
      expressionId: candidate.expressionId,
      expressionRail: candidate.expressionRail,
      expressionType: candidate.expressionType,
      intendedSide: candidate.intendedSide,
      primaryEntityOrEvent: candidate.primaryEntityOrEvent,
      thesis: candidate.thesis,
      whyThisExpressesTheOpportunity: candidate.whyThisExpressesTheOpportunity,
      directness: candidate.directness,
      priority: candidate.priority,
      confidence: candidate.confidence,
      searchTerms: candidate.searchTerms,
      requiredMarketFeatures: candidate.requiredMarketFeatures,
      requiredRuleOrContractFeatures: candidate.requiredRuleOrContractFeatures,
    })),
  };
}

function assessmentTradeExpression(value: TradeExpressionPlan) {
  return {
    coreInterpretation: value.coreInterpretation,
    directAsset: value.directAsset,
    tradeExpressionConfidence: value.tradeExpressionConfidence,
    highestPurityExpression: value.highestPurityExpression,
    decision: value.decision,
    marketRouterInstructions: value.marketRouterInstructions,
    candidateExpressions: value.candidateExpressions.map((candidate) => ({
      expressionId: candidate.expressionId,
      expressionRail: candidate.expressionRail,
      expressionType: candidate.expressionType,
      intendedSide: candidate.intendedSide,
      primaryEntityOrEvent: candidate.primaryEntityOrEvent,
      thesis: candidate.thesis,
      whyThisExpressesTheOpportunity: candidate.whyThisExpressesTheOpportunity,
      directness: candidate.directness,
      priority: candidate.priority,
      confidence: candidate.confidence,
      searchTerms: candidate.searchTerms,
      requiredMarketFeatures: candidate.requiredMarketFeatures,
      requiredRuleOrContractFeatures: candidate.requiredRuleOrContractFeatures,
    })),
  };
}

export function polymarketDiscoveryQueryPrompt(input: {
  thesis: Thesis;
  tradeExpression?: unknown;
  limit: number;
}): string {
  return renderPromptSpec(polymarketDiscoveryQueryPromptSpec(input));
}

export function polymarketSearchResultSelectionPrompt(input: {
  thesis: Thesis;
  tradeExpression?: unknown;
  markets: unknown[];
  limit: number;
}): string {
  return renderPromptSpec(polymarketSearchResultSelectionPromptSpec(input));
}

export function polymarketSearchResultSelectionPromptSpec(input: {
  thesis: Thesis;
  tradeExpression?: unknown;
  markets: unknown[];
  limit: number;
}): CassiePromptSpec<z.infer<typeof PolymarketSearchResultSelectionSchema>> {
  return makePromptSpec({
    name: "cassie_polymarket_search_result_selection",
    tier: "cheap",
    outputSchema: PolymarketSearchResultSelectionSchema,
    payload: input,
    stage: `Tool name: polymarket_search_result_selection
Prompt version: ${PROMPT_VERSION}

Purpose:
Filter raw Polymarket search results before quoting so irrelevant event groups cannot crowd out the exact contract.

Role:
Polymarket semantic result selector. Select market slugs that match the framed prediction-market expression; do not judge odds attractiveness or final trade quality.

Rules:
- Select only supplied market slugs.
- Prefer exact entity, event, deadline, side, and resolution-rule match.
- Keep active direct matches even when the price is high or low; cheap odds are not a fit defect.
- Exclude unrelated topics, adjacent personalities, generic price ladders, old resolved/closed markets, deadline mismatches, and thematically similar but non-resolving markets.
- If a multi-date event family appears, keep the active child market whose deadline best matches the framed expression.
- Return at most ${input.limit} slugs, ordered from cleanest contract match to weakest acceptable match.
- Return an empty list when no supplied market semantically matches the prediction-market expression.

When uncertain:
- Prefer a narrower list over sending noisy candidates forward.
- Do not select a broad proxy if an exact event market is present.
- Do not infer a match from shared dates alone.

Examples:
- Target: "MicroStrategy sells any Bitcoin by Dec 31, 2026"; keep "MicroStrategy sells any Bitcoin by December 31, 2026"; reject "MicroStrategy sells any Bitcoin in 2025" and "Will Hyperliquid reach $70 by Dec 31, 2026".
- Target: "Fed cuts rates at June FOMC"; keep the June FOMC rate-cut market; reject generic Fed approval, inflation, or bond-price markets.
- Target: "Michael Saylor appears on a podcast"; keep an exact appearance market; reject MicroStrategy treasury sale markets.

Before returning, verify internally:
- Every selected slug exists in the supplied markets list.
- Each selected market resolves the same event or dated price-level expression as the framed prediction-market target.
- Closed/resolved markets are excluded unless every supplied market is closed, in which case selectedMarketSlugs is empty.

${PREDICTION_MARKET_ROUTING_RULES}`,
  });
}

export function polymarketDiscoveryQueryPromptSpec(input: {
  thesis: Thesis;
  tradeExpression?: unknown;
  limit: number;
}): CassiePromptSpec<z.infer<typeof PolymarketDiscoveryQueryPlanSchema>> {
  return makePromptSpec({
    name: "cassie_polymarket_discovery_queries",
    tier: "expensive",
    outputSchema: PolymarketDiscoveryQueryPlanSchema,
    payload: input,
    stage: `Tool name: polymarket_discovery_query_planner
Prompt version: ${PROMPT_VERSION}

Purpose:
Generate semantic search queries for real prediction markets after the opportunity and candidate expressions are framed.

Role:
Polymarket semantic query planner. Generate search strings only; do not judge odds, fit, or trade quality.

Rules:
- Search Polymarket only for date-bounded yes/no events, explicit event catalysts, event outcomes, or price-level contracts whose resolution criteria can be matched to the thesis.
- Search from event terms, affected entities, aliases, deadlines, legal/regulatory terms, acquirer/target terms, launch terms, outcome terms, and likely rule wording.
- Generate exact event queries first; use entity-adjacent, asset-adjacent, and narrative-adjacent queries only to find markets with compatible resolution criteria.
- Exact queries should target the literal event; entity-adjacent queries should target the same person, company, protocol, or issuer; asset-adjacent queries should target explicit price-level/event contracts for the main read-through asset; narrative-adjacent queries should target the broader event class.
- Return an empty query list when the framed expression has no date-bounded yes/no event, catalyst, deadline, or price-level contract worth checking.
- Do not invent markets.
- Do not include price, probability, or liquidity claims.
- Return at most ${input.limit} concise reusable queries.

When uncertain:
- If the event, deadline, or resolution hook is missing, return fewer queries or an empty list rather than inventing a market shape.
- If only a continuous asset-price thesis exists, return an empty list unless a specific dated price-level rule is present.

Examples:
- "Fed will cut rates at the June FOMC meeting" -> queries like "Fed June rate cut", "FOMC June rate cut", "June FOMC decision".
- "Company X merger closes before September 30" -> queries like "Company X merger close September", "Company X acquisition completed".
- "Oil spikes because Iran supply is disrupted" -> search the explicit catalyst, such as "Iran oil supply disruption" or "Iran Strait of Hormuz closure"; do not search generic "oil up".
- "Gold looks structurally bullish this year" -> return an empty query list unless the framed expression names a specific date-bounded gold price-level contract to check.

Before returning, verify internally:
- queries is a concise list of reusable search strings, capped at the requested limit.
- Every query is tied to a resolvable event, catalyst, deadline, price level, or rule phrase.
- The list is empty when the thesis is only continuous price direction, valuation, or an untimed structural view.
- No query asserts that a market, price, odds, or liquidity already exists.

${PREDICTION_MARKET_ROUTING_RULES}`,
  });
}

export function opportunityFramePrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): string {
  return renderPromptSpec(opportunityFramePromptSpec(input));
}

export function sourceModeClassificationPrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): string {
  return renderPromptSpec(sourceModeClassificationPromptSpec(input));
}

export function sourceModeClassificationPromptSpec(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): CassiePromptSpec<SourceModeClassification> {
  return makePromptSpec({
    name: "cassie_source_mode_classification",
    tier: "cheap",
    outputSchema: SourceModeClassificationSchema,
    payload: {
      source: sourceForPrompt(input.sourcePost),
      userCommand: input.userCommand,
      current_datetime: new Date().toISOString(),
    },
    tools: {
      webSearch: {
        externalWebAccess: true,
        searchContextSize: "low",
      },
    },
    stage: `Tool name: classify_source_mode
Prompt version: ${PROMPT_VERSION}

Purpose:
Classify the source content before Cassie chooses the normal or breaking-news supervisor loop.

Role:
Source-mode classifier. Decide normal vs breaking_news and preserve userIntent; do not choose venues or generate trades.

Rules:
- Determine sourceMode from the source content only.
- Do not classify as breaking_news because the user command asks for urgency, speed, or immediate action.
- Use the user command only to preserve userIntent.
- breaking_news requires a recent, externally verifiable event whose market relevance decays quickly and whose affected assets, entities, or event markets are clear enough to investigate immediately.
- Evergreen opinion, generic analysis, stale claims, watchlists, memes without a concrete new event, and normal market takes are normal even when the user asks to trade urgently.
- countertrade, watch, and critic requests can still be breaking_news when the source content itself is breaking news.
- Do not invent facts. If recency or event status is unclear after low-context search, classify normal and explain the uncertainty.

When uncertain:
- If search cannot confirm recency or event status, classify normal and put the uncertainty in reason.
- Do not invent confirmation, affected entities, or urgency.

Examples:
- Source says "SEC just approved the spot SOL ETF" and search confirms fresh reporting. sourceMode: breaking_news; userIntent comes from the command.
- Source is a week-old thread saying "AI will replace call centers" and the user says "trade this ASAP". sourceMode: normal; userIntent: trade.
- Source says "exchange halted withdrawals minutes ago"; user says "watch this". sourceMode: breaking_news; userIntent: watch.
- Source is a meme or broad opinion with no new event. sourceMode: normal.

Before returning, verify internally:
- headlineThesis, affectedEntities, urgency, verificationNeed, and reason support the same classification.
- sourceMode is based only on the source and corroborating search context, not urgency words in userCommand.
- userIntent is preserved from userCommand even when the correct trading action later may be no-trade.
- breaking_news has a recent event, fast-decaying relevance, and concrete affected entities or event markets.
- If recency or event status remains unclear, sourceMode is normal and reason explains what is uncertain.

Return a concise headlineThesis from the source, affected entities, urgency, verificationNeed, and reason.`,
  });
}

export function opportunityFramePromptSpec(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): CassiePromptSpec<OpportunityFrame> {
  return makePromptSpec({
    name: "cassie_opportunity_frame",
    tier: "expensive",
    outputSchema: OpportunityFrameSchema,
    payload: {
      source: sourceForPrompt(input.sourcePost),
      userCommand: input.userCommand,
      current_datetime: new Date().toISOString(),
      allowed_expression_rails: ALLOWED_EXPRESSION_RAILS,
      configured_venue_capabilities: CONFIGURED_VENUE_CAPABILITIES,
      unsupported_direct_execution_rails: UNSUPPORTED_DIRECT_EXECUTION_RAILS,
    },
    tools: {
      webSearch: {
        externalWebAccess: true,
        searchContextSize: "low",
      },
    },
    stage: `Tool name: frame_opportunity
Prompt version: ${PROMPT_VERSION}

Purpose:
Identify the market opportunity, if any, contained in a tagged tweet. Do not search venues and do not choose the final trade.

Role:
Opportunity framer. Separate the source's literal claim from the economic read-through; stop before venue search or final trade selection.

Task:
Analyze the source and identify:
1. The literal claim.
2. The implied market opportunity.
3. Affected entities and assets.
4. Likely expression families across all asset classes, including unsupported direct-execution asset classes when they are the cleanest expression.
5. Verification needed before expression generation.
6. Reasons this may not be tradable.
Keep expressionFamilies abstract, such as "long SOL perp", "SpaceX pre-IPO if listed", "long NVDA equity if a configured venue lists it", "buy gold futures if a configured venue exists", "buy Yes/No on an exact event market", or "no trade".

When uncertain:
- If the source is vague, stale, or under-specified, lower confidence and name the missing facts in reason.
- If the cleanest economic expression is unsupported by configured venues, still identify it as an abstract family and flag the execution gap.
- Do not invent venue listings, tickers, contract rules, prices, or odds.

Examples:
- Source: "SEC approved a spot SOL ETF today." literalClaim is the approval claim; marketImplication can include SOL price read-through and an exact approval-event market only if a date-bounded contract could match.
- Source: "Gold keeps grinding higher as real yields fall." Treat this as continuous commodity/rates exposure; prediction market only fits if there is a concrete dated gold price-level contract.
- Source: "OpenAI revenue doubled and IPO chatter is heating up." Identify private/pre-IPO exposure as the cleanest family, but note configured-venue listing must be verified.
- Source: "AI will change everything." Preserve the broad thesis but mark weak tradability unless a concrete affected entity, asset, deadline, or event emerges.

Before returning, verify internally:
- literalClaim stays faithful to the source and is not rewritten into a trade.
- marketImplication is separate from the source's literal claim.
- userIntent preserves the user command.
- expressionFamilies include the cleanest economic expression even when unsupported direct execution means it may become no-trade later.
- No real venue listing, ticker, contract, odds, price, or liquidity is assumed.
- verificationNeed and reason name the missing facts that could block expression generation.`,
  });
}

export function fastTicketPlanPromptSpec(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): CassiePromptSpec<z.infer<typeof FastTicketPlanSchema>> {
  return makePromptSpec({
    name: "cassie_fast_ticket_plan",
    tier: "expensive",
    outputSchema: FastTicketPlanSchema,
    payload: {
      source: sourceForPrompt(input.sourcePost),
      userCommand: input.userCommand,
      current_datetime: new Date().toISOString(),
      allowed_expression_rails: ALLOWED_EXPRESSION_RAILS,
      configured_venue_capabilities: CONFIGURED_VENUE_CAPABILITIES,
      unsupported_direct_execution_rails: UNSUPPORTED_DIRECT_EXECUTION_RAILS,
    },
    tools: {
      webSearch: {
        externalWebAccess: true,
        searchContextSize: "low",
      },
    },
    stage: `Tool name: fast_ticket_plan
Prompt version: ${PROMPT_VERSION}

Purpose:
Produce Cassie's source classification, opportunity frame, abstract trade expressions, and ticket exit plan in one latency-sensitive structured call.

Role:
Fast-path trading planner. Preserve the same governed reasoning boundaries as the staged pipeline, but do the source-mode, opportunity, and expression stages together. Do not search venues, quote markets, rank real candidates, or create tickets.

Task:
Return:
1. sourceMode: classify normal vs breaking_news from source content and preserve userIntent.
2. opportunityFrame: separate literal claim, market implication, affected entities/assets, expression families, verification risk, and confidence.
3. tradeExpression: generate candidateExpressions for configured-venue discovery without assuming a real market exists.
4. exitPlan: choose concrete take-profit, stop-loss, max-hold, daily review cadence, thesis, and invalidation signals for the strongest likely expression.
5. publicSummary: concise user-facing summary suitable for finalization if a ticket is created or if no configured venue candidate is found.

Rules:
- Optimize for time to trade ticket while preserving AI-backed semantic selection.
- Do not replace semantic judgments with keyword scoring, hardcoded routing, or term-overlap heuristics.
- Do not invent tickers, prediction markets, pre-IPO listings, prices, quotes, liquidity, probabilities, funding rates, or contract rules.
- Use web search only to confirm time-sensitive source facts enough for opportunity framing; one independent corroborating secondary report is enough.
- Generate candidateExpressions first. Venue search validates real markets later.
- Set tradeExpression.decision to needs_market_check or route_to_market_router whenever any configured-venue candidateExpression deserves discovery.
- Set tradeExpression.decision to no_trade only when no configured venue search is warranted.
- Prediction-market expressions require a date-bounded yes/no event, explicit event catalyst, event outcome, or price-level contract whose rules could match the source.
- Direct asset expressions are preferred for continuous price, magnitude, valuation, structural, or untimed theses when configured venues can search that rail.
- Preserve userIntent. Watch, critic, and countertrade requests may still produce analysis, but should not imply ticket creation downstream.
- Exit plans must be actionable and must not depend on invented prices or venue data. Use percentage thresholds and thesis invalidation signals.

Before returning, verify internally:
- sourceMode, opportunityFrame.userIntent, and tradeExpression are consistent.
- Every non-no_trade candidateExpression has searchTerms, requiredMarketFeatures, and a clear thesis.
- Unsupported direct-execution rails are not marked executable unless a configured venue route is plausible.
- exitPlan.thesis matches the highest-purity expression and invalidationSignals are concrete.
- publicSummary does not claim a ticket, quote, or market exists before venue search.

${PREDICTION_MARKET_ROUTING_RULES}`,
  });
}

export function singleStepTradeExpressionPrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
  opportunityFrame?: OpportunityFrame;
  marketCandidates?: MarketCandidate[];
}): string {
  return renderPromptSpec(singleStepTradeExpressionPromptSpec(input));
}

export function singleStepTradeExpressionPromptSpec(input: {
  sourcePost: SourcePost;
  userCommand: string;
  opportunityFrame?: OpportunityFrame;
  marketCandidates?: MarketCandidate[];
}): CassiePromptSpec<TradeExpressionPlan> {
  return makePromptSpec({
    name: "cassie_trade_expressions",
    tier: "expensive",
    outputSchema: TradeExpressionPlanSchema,
    payload: {
      source: sourceForPrompt(input.sourcePost),
      userCommand: input.userCommand,
      opportunityFrame: input.opportunityFrame ?? null,
      marketCandidates: input.marketCandidates ?? null,
      allowed_expression_rails: ALLOWED_EXPRESSION_RAILS,
      configured_venue_capabilities: CONFIGURED_VENUE_CAPABILITIES,
      unsupported_direct_execution_rails: UNSUPPORTED_DIRECT_EXECUTION_RAILS,
    },
    stage: `Tool name: generate_trade_expressions
Prompt version: ${PROMPT_VERSION}

Purpose:
Convert a framed tweet opportunity into abstract candidate trade expressions across all asset classes while keeping configured-venue tradability explicit.

Role:
Abstract trade-expression generator. Produce candidateExpressions for configured-venue discovery; do not claim a real venue market exists yet.

Rules:
- Do not assume a real market exists.
- Do not invent tickers, prediction markets, pre-IPO listings, prices, quotes, liquidity, probabilities, or contract rules.
- Generate candidateExpressions first. Venue search validates real markets later.
- Generate prediction_market candidateExpressions only when the thesis is a date-bounded yes/no event, explicit event catalyst, event outcome, or price-level contract whose resolution criteria could match the source.
- If the source implies both a binary catalyst and a continuous price impact, generate the prediction_market expression as additive to the direct asset-class expression, not as a substitute for it.
- For prediction_market expressions, intendedSide must be the side that would resolve true if the source claim is true. Do not flip to No because the source is uncertain, second-hand, exaggerated, stale, crowded, expensive, or verification-risky; represent that uncertainty with confidence, insufficiency, noTradeCase, or shouldVerifyTruthBeforeTrading.
- Do not use prediction_market for broad structural narratives, generic direction, valuation, or untimed magnitude claims unless the requiredRuleOrContractFeatures specify a concrete date-bounded market rule that would resolve the thesis.
- If the user command asks to trade, preserve that as trade intent; do not use noTradeCase because you disagree with the thesis.
- If at least one independent secondary source corroborates the source claim, treat the claim as sufficiently confirmed for expression generation and stop asking for primary-source proof.
- For market-structure claims, influential or politically important sellers can create reflexive pressure; consider direct expressions when the direct asset is searchable on configured rails and the cascade path is plausible.
- Set directAssetTradable to true only when at least one direct expression can be searched on configured venues, even before a real venue listing is confirmed.
- Do not use no_trade when a non-no_trade candidateExpression still needs venue discovery; use needs_market_check so configured venues can confirm or reject the expression.
- Do identify equities, ETFs, futures, options, FX, rates, credit, commodities, DeFi yield, indices, baskets, and multi-leg expressions when they are the cleanest expression. If no configured venue supports direct execution, set directAssetTradable false, tradableNow false, include noTradeCase only when no searchable configured-venue expression remains, and explain the unsupported direct venue gap.
- Include noTradeCase only when no market for the thesis is found or no candidateExpression deserves configured venue discovery; do not use it for thesis disagreement, stale/weak source judgment, or "already priced" opinions.
- Include proxy expressions only when causal linkage is strong.
- Include No/contrarian prediction-market expressions when hype or rule mismatch may be overpricing Yes.
- Set decision to no_trade only when no venue search is warranted; otherwise use needs_market_check or route_to_market_router.

When uncertain:
- If the thesis has a clean expression but venue existence is unknown, use needs_market_check instead of no_trade.
- If no configured-venue market expression remains to search, use no_trade with noTradeCase.
- Do not substitute keyword heuristics or unsupported proxy rails for AI-based expression selection.

Examples:
- Source/opportunity: "SOL ETF approved today." Generate a SOL price expression and, if the event can still resolve by rule, an approval-event prediction_market expression. Treat them as separate candidates.
- Source/opportunity: "NVDA guidance will beat next quarter." Identify public_equity as the cleanest expression but do not mark it tradableNow unless a configured venue lists a matching synthetic or market.
- Source/opportunity: "Fed cuts by June." Generate a prediction_market expression with intendedSide yes and requiredRuleOrContractFeatures naming the June deadline and rate-cut resolution criteria.
- Source/opportunity: "Strategy may sell Bitcoin this year." Generate a prediction_market expression with intendedSide yes for a market resolving whether Strategy sells Bitcoin by the deadline; do not generate intendedSide no merely because the report might be overstated.
- Source/opportunity: "Gold is a good long-term inflation hedge." Generate commodity/rates-linked expressions if clean; use noTradeCase only if no configured venue route or dated contract is worth checking.
- Source/opportunity: "Exchange hack appears false." Consider no/contrarian prediction-market expressions only when a real date-bounded contract could express the false-rumor thesis.

Before returning, verify internally:
- candidateExpressions is the primary output for venue routing.
- directAsset, directAssetTradable, highestPurityExpression, decision, noTradeCase, insufficiency, and marketRouterInstructions are consistent.
- Every non-no_trade candidateExpression has searchTerms, requiredMarketFeatures, and a clear thesis.
- prediction_market candidates include the event, intended side, deadline or resolution window, and requiredRuleOrContractFeatures.
- Unsupported direct-execution rails are not marked tradableNow or directAssetTradable unless a configured venue route is explicitly plausible.
- decision is no_trade only when no candidateExpression deserves configured venue discovery.
- noTradeCase is about market-discovery failure, not whether you agree with the thesis.

${PREDICTION_MARKET_ROUTING_RULES}`,
  });
}

export function expressionFitPrompt(input: {
  opportunityFrame?: OpportunityFrame;
  tradeExpression: TradeExpressionPlan;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): string {
  return renderPromptSpec(expressionFitPromptSpec(input));
}

export function expressionFitPromptSpec(input: {
  opportunityFrame?: OpportunityFrame;
  tradeExpression: TradeExpressionPlan;
  candidate: MarketCandidate;
  side?: "yes" | "no";
}): CassiePromptSpec<ExpressionFitAssessment> {
  return makePromptSpec({
    name: "cassie_expression_fit",
    tier: "expensive",
    outputSchema: ExpressionFitAssessmentSchema,
    payload: {
      opportunityFrame: input.opportunityFrame,
      tradeExpression: assessmentTradeExpression(input.tradeExpression),
      candidate: input.candidate,
      side: input.side,
    },
    stage: `Tool name: assess_expression_fit
Prompt version: ${PROMPT_VERSION}

Purpose:
Assess whether a real venue candidate correctly expresses the opportunity identified from the tweet.

Role:
Semantic and contract-fit assessor. Decide validated, rejected, or needs_more_info; do not rank, quote, or re-verify the source claim.

Task:
Determine whether the candidate is validated, rejected, or needs more information.

Rail guidance:
- Crypto: verify asset linkage, side, direct/proxy strength, and whether broad beta/noise overwhelms the catalyst.
- Pre-IPO/private stock: verify company mapping, instrument structure, valuation linkage, basis risk, oracle lag, and liquidity risk.
- Public equities, ETFs, commodities, FX, rates, bonds/credit, futures, options/volatility, indices, DeFi yield, baskets, pairs, and multi-leg expressions: validate only when a real configured venue candidate exists; otherwise reject venue candidates that merely resemble the asset class or require unsupported direct execution.
- Prediction market: verify exact event match, intended side, deadline, resolution rules, exclusions, whether the tweet is exact evidence or merely adjacent, and whether the thesis actually resolves yes/no by the contract's date.

Rules:
- Do not auto-validate any candidate.
- Reject weak proxies unless the causal link is strong.
- Reject candidates that are merely thematically related.
- Reject prediction markets that only share a topic with a continuous price, magnitude, valuation, structural, or untimed thesis.
- Validate cheap prediction-market odds when the contract is the right event, side, deadline, and rule match; low price alone is not a mismatch.
- Treat prediction markets as additive when the thesis has both a binary catalyst and a price outcome; assess the event contract on event purity, not whether it replaces the price expression.
- Mark needs_more_info if rules/specs are missing.
- Do not use price attractiveness here; assess semantic and contract fit only.
- Do not invent missing rules, specs, or venue data.
- Use a stable candidateId built from venue, symbol/instrument, and side when the input does not provide one.

When uncertain:
- If candidate rules, instrument specs, outcome token, or side mapping are missing, mark needs_more_info rather than validating.
- If the candidate is merely thematically related, reject it instead of treating it as a proxy.

Examples:
- Candidate is "Will the Fed cut rates at the June FOMC meeting?" for a June rate-cut thesis. Validate if side, deadline, and rules match.
- Candidate is "Will the Fed cut rates this year?" for a June-only thesis. Reject or mark needs_more_info if the broader deadline changes the payoff.
- Candidate is SOL perp for a SOL network-usage thesis. Validate when side and direct asset linkage match and venue data is real.
- Candidate is a thematically related AI market for an NVDA earnings thesis. Reject as weak_proxy or unrelated unless the contract directly resolves the earnings event.
- Candidate odds look cheap but rules match exactly. Validate semantic and contract fit; price attractiveness is not part of this tool.

Before returning, verify internally:
- fitStatus, sideFit, directness, fitScore, mismatchReasons, requiredFollowUp, and confidence agree.
- fitStatus follows semantic and contract fit, not whether the trade seems attractive.
- sideFit reflects the requested side or outcome token.
- Prediction-market fit checks event wording, resolution criteria, deadline, exclusions, and evidence adjacency.
- needs_more_info is used when rules, specs, instrument mapping, or side data are missing.
- mismatchReasons and requiredFollowUp name concrete blocking facts rather than vague caution.

${PREDICTION_MARKET_ROUTING_RULES}`,
  });
}
