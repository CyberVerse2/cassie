import type { ModelMessage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { ModelTier, StructuredToolConfig } from "../ai/client.ts";
import {
  CassieCommandClassificationSchema,
  ExpressionFitAssessmentSchema,
  ExpressionRailSchema,
  MarketSelectionSchema,
  OpportunityFrameSchema,
  OpportunityTradePlanSchema,
  SourceContextDiscoverySchema,
  SourceModeClassificationSchema,
  TradeExpressionPlanSchema,
  type ExpressionFitAssessment,
  type CassieCommandClassification,
  type MarketCandidate,
  type MarketSelection,
  type OpportunityFrame,
  type SourceContextDiscovery,
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
    url: sourcePost.url,
    author: sourcePost.authorHandle,
    authorName: sourcePost.authorName,
    createdAt: sourcePost.createdAt,
    quotedPostText: sourcePost.quotedPostText,
    linkedUrls: sourcePost.linkedUrls,
    mediaDescriptions: sourcePost.mediaDescriptions,
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
      const content =
        typeof message.content === "string"
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
- Treat upstream fitAssessments as authoritative for expression-to-candidate mapping. Do not re-litigate source truth, thesis quality, timing, correction risk, or whether a candidate should have been validated.
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
- Prediction-market selection follows side, deadline, and event fit rather than odds attractiveness.

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
  const tradeExpression =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<TradeExpressionPlan>)
      : null;
  if (!tradeExpression) return value ?? null;

  return {
    directAsset: tradeExpression.directAsset,
    highestPurityExpression: tradeExpression.highestPurityExpression,
    decision: tradeExpression.decision,
    marketDiscovery: tradeExpression.marketDiscovery,
    abstractExpressions: (tradeExpression.candidateExpressions ?? []).map(
      (candidate) => ({
        expressionId: candidate.expressionId,
        expressionRail: candidate.expressionRail,
        expressionType: candidate.expressionType,
        intendedSide: candidate.intendedSide,
        primaryEntityOrEvent: candidate.primaryEntityOrEvent,
        thesis: candidate.thesis,
        directness: candidate.directness,
        priority: candidate.priority,
        confidence: candidate.confidence,
        searchTerms: candidate.searchTerms,
        requiredMarketFeatures: candidate.requiredMarketFeatures,
        requiredRuleOrContractFeatures:
          candidate.requiredRuleOrContractFeatures,
      }),
    ),
  };
}

function assessmentTradeExpression(value: TradeExpressionPlan) {
  return {
    directAsset: value.directAsset,
    highestPurityExpression: value.highestPurityExpression,
    decision: value.decision,
    candidateExpressions: value.candidateExpressions.map((candidate) => ({
      expressionId: candidate.expressionId,
      expressionRail: candidate.expressionRail,
      expressionType: candidate.expressionType,
      intendedSide: candidate.intendedSide,
      primaryEntityOrEvent: candidate.primaryEntityOrEvent,
      thesis: candidate.thesis,
      directness: candidate.directness,
      priority: candidate.priority,
      confidence: candidate.confidence,
      searchTerms: candidate.searchTerms,
      requiredMarketFeatures: candidate.requiredMarketFeatures,
      requiredRuleOrContractFeatures: candidate.requiredRuleOrContractFeatures,
    })),
  };
}

function assessmentMarketCandidate(candidate: MarketCandidate) {
  if (candidate.venue === "hyperliquid") {
    return {
      venue: candidate.venue,
      symbol: candidate.symbol,
      instrument: candidate.instrument,
      side: candidate.side,
      markPrice: candidate.markPrice,
      spreadBps: candidate.spreadBps,
      liquidityScore: candidate.liquidityScore,
      estimatedSlippageBps: candidate.estimatedSlippageBps,
      minOrderSizeUsd: candidate.minOrderSizeUsd,
      thesisFit: candidate.thesisFit,
      reason: candidate.reason,
      warnings: candidate.warnings,
    };
  }

  return {
    venue: candidate.venue,
    symbol: candidate.symbol,
    instrument: candidate.instrument,
    side: candidate.side,
    marketQuestion: candidate.marketQuestion,
    marketSlug: candidate.marketSlug,
    outcome: candidate.outcome,
    conditionId: candidate.conditionId,
    outcomeTokenId: candidate.outcomeTokenId,
    yesOutcomeTokenId: candidate.yesOutcomeTokenId,
    noOutcomeTokenId: candidate.noOutcomeTokenId,
    yesPrice: candidate.yesPrice,
    noPrice: candidate.noPrice,
    heldSidePrice: candidate.heldSidePrice,
    volumeUsd: candidate.volumeUsd,
    liquidityUsd: candidate.liquidityUsd,
    endDate: candidate.endDate,
    markPrice: candidate.markPrice,
    spreadBps: candidate.spreadBps,
    liquidityScore: candidate.liquidityScore,
    estimatedSlippageBps: candidate.estimatedSlippageBps,
    minOrderSizeUsd: candidate.minOrderSizeUsd,
    thesisFit: candidate.thesisFit,
    reason: candidate.reason,
    warnings: candidate.warnings,
    resolutionRules: candidate.resolutionRules ?? null,
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

export function cassieCommandClassificationPromptSpec(input: {
  mentionText: string;
  cassieHandle: string;
}): CassiePromptSpec<CassieCommandClassification> {
  return makePromptSpec({
    name: "cassie_command_classification",
    tier: "cheap",
    outputSchema: CassieCommandClassificationSchema,
    payload: {
      mentionText: input.mentionText,
      cassieHandle: input.cassieHandle,
    },
    stage: `Tool name: classify_cassie_command
Prompt version: ${PROMPT_VERSION}

Purpose:
Classify whether an X reply that mentions Cassie is asking Cassie to act, and preserve the intended command.

Role:
Webhook command-intent classifier. Decide only the user's command intent from the reply text. Do not analyze the source post, choose venues, or generate trades.

Rules:
- Return trade when the user asks Cassie to enter, buy, short, long, ape, take, play, trade, or otherwise get exposure to the referenced source.
- Return trade for natural phrases like "get me in", "I'm in", "send it", "take this", "buy this", "let's run this", or "put me on this" when directed at Cassie.
- Return countertrade when the user asks Cassie to fade, inverse, short against, or counter the referenced source.
- Return watch when the user asks Cassie to monitor, track, follow, alert, or keep an eye on the referenced source without entering.
- Return critic for critique, review, analyze, check, sanity-check, or tell me if this is wrong.
- Return not_a_command for casual mentions, jokes, praise, complaints, questions about Cassie itself, or unclear text with no requested action.
- Ignore other @handles in the reply. They are conversation context, not the command target.
- Preserve slang and informal trading language when it clearly asks for exposure.
- Do not require the exact words trade, watch, review, or countertrade.

Examples:
- "@cassiedottrade get me in on this" -> trade.
- "@himgajria @cassiedottrade get me in on this shi" -> trade.
- "@cassiedottrade fade this" -> countertrade.
- "@cassiedottrade keep an eye on this" -> watch.
- "@cassiedottrade is this real?" -> critic.
- "having @cassiedottrade on the timeline feels great" -> not_a_command.

Before returning, verify internally:
- intent is based only on the mention text.
- confidence reflects ambiguity.
- reason is concise and names the phrase that drove the classification.`,
  });
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

export function sourceContextDiscoveryPromptSpec(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): CassiePromptSpec<SourceContextDiscovery> {
  return makePromptSpec({
    name: "cassie_context_discovery",
    tier: "expensive",
    outputSchema: SourceContextDiscoverySchema,
    payload: {
      source: sourceForPrompt(input.sourcePost),
      userCommand: input.userCommand,
      current_datetime: new Date().toISOString(),
    },
    tools: {
      webSearch: {
        externalWebAccess: true,
        searchContextSize: "medium",
      },
    },
    stage: `Tool name: discover_source_context
Prompt version: ${PROMPT_VERSION}

Purpose:
Find what an ambiguous tagged post is referring to before trade planning.

Role:
Context scout. Treat vague social posts as clues. Look around the source, links, media, quoted context, author context, and timely public discussion to identify grounded claims. Do not create trade plans, venues, tickets, prices, odds, or liquidity.

Rules:
- Return only discovered context: summary, claims, entities, assets, and confidence.
- Claims must be grounded in source/context you can identify, not invented from vibes.
- If context remains unresolved, return empty claims/assets/entities as needed, low confidence, and say what could not be resolved in summary.
- Multiple plausible claims are allowed; keep them concise.
- For assets, do not limit yourself to tickers or asset names explicitly discovered in the context. Always ask: are there any assets that you can infer will be affected by this?
- If the discovered context is about a product, drug, commodity, protocol, regulation, lawsuit, approval, ban, supply shock, demand shock, or sector event, search for public companies, tokens, commodities, suppliers, customers, competitors, or venue-searchable assets exposed to that category before returning assets: [].
- Before returning assets: [], first check whether the discovered claims imply an affected public company, token, commodity, sector exposure, product-exposed business, supplier, customer, competitor, or venue-searchable asset.
- Include inferred affected assets when the context implies them, and make the inference legible in summary or claims by naming the causal link, e.g. product/category exposure, supplier/customer exposure, regulatory exposure, or competitor impact.
- Do not decide no-trade. This step only discovers context.`,
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

export function opportunityTradePlanPrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
  marketCandidates?: MarketCandidate[];
  contextDiscovery?: SourceContextDiscovery | null;
}): string {
  return renderPromptSpec(opportunityTradePlanPromptSpec(input));
}

export function opportunityTradePlanPromptSpec(input: {
  sourcePost: SourcePost;
  userCommand: string;
  marketCandidates?: MarketCandidate[];
  contextDiscovery?: SourceContextDiscovery | null;
}): CassiePromptSpec<z.infer<typeof OpportunityTradePlanSchema>> {
  return makePromptSpec({
    name: "cassie_opportunity_trade_plan",
    tier: "expensive",
    outputSchema: OpportunityTradePlanSchema,
    payload: {
      source: sourceForPrompt(input.sourcePost),
      discoveredContext: input.contextDiscovery ?? null,
      userCommand: input.userCommand,
      marketCandidates: input.marketCandidates ?? null,
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
    stage: `Tool name: plan_opportunity_and_trade_expressions
Prompt version: ${PROMPT_VERSION}

Purpose:
Frame the market opportunity and produce abstract candidate trade expressions in one structured step. Do not search venues, quote markets, rank candidates, or create a ticket.

Role:
Opportunity framer and abstract expression planner. Separate the source's literal claim from the economic read-through, then produce candidateExpressions for configured venue discovery.

Rules:
- Return both opportunityFrame and tradeExpression.
- Do not assume a real market exists.
- Do not invent tickers, prediction markets, pre-IPO listings, prices, quotes, liquidity, probabilities, or contract rules.
- opportunityFrame.literalClaim must stay faithful to the source plus discoveredContext; opportunityFrame.marketImplication must be the economic read-through.
- If discoveredContext is present, use it as the resolved clue context. Do not ignore grounded claims just because the visible post text was vague.
- Generate abstract candidateExpressions for venue discovery. Venue search validates real markets later.
- Use tradeExpression.marketDiscovery for shared venue-search state; keep candidateExpressions focused on expression-specific requirements.
- Generate prediction_market candidateExpressions only when the thesis is a date-bounded yes/no event, explicit event catalyst, event outcome, or price-level contract whose resolution criteria could match the source.
- If the source implies both a binary catalyst and continuous price impact, generate the prediction_market expression as additive to the direct asset-class expression, not a substitute.
- For prediction_market expressions, intendedSide must be the side that would resolve true if the source claim is true. Represent uncertainty with confidence, insufficiency, noTradeCase, or shouldVerifyTruthBeforeTrading.
- Set directAssetTradable true only when at least one direct expression can be searched on configured venues, even before a real venue listing is confirmed.
- Do not use no_trade when a non-no_trade candidateExpression still needs venue discovery; use needs_market_check so configured venues can confirm or reject the expression.
- Identify unsupported clean expressions, but do not mark them tradableNow or directAssetTradable unless a configured venue route is explicitly plausible.
- Include noTradeCase only when no market for the thesis is found or no candidateExpression deserves configured venue discovery; do not use it for thesis disagreement, stale/weak source judgment, or already-priced opinions.
- Include proxy expressions only when causal linkage is strong.
- Set tradeExpression.decision to no_trade only when no venue search is warranted; otherwise use needs_market_check or route_to_market_router.

When uncertain:
- If discoveredContext is absent and the source is vague, stale, or under-specified, lower confidence and name the missing facts in opportunityFrame.reason and tradeExpression.insufficiency.
- If discoveredContext is present but low-confidence or empty, then insufficiency can reflect failed context discovery.
- If the cleanest economic expression is unsupported by configured venues, identify it but explain the execution gap.
- If venue existence is unknown for a clean expression, use needs_market_check instead of no_trade.

Before returning, verify internally:
- opportunityFrame and tradeExpression describe the same thesis and user intent.
- candidateExpressions identify the abstract expressions that venue discovery should search.
- marketDiscovery describes shared venue-search state; candidateExpressions describe expression-specific requirements.
- Every non-no_trade candidateExpression has searchTerms, requiredMarketFeatures, and a clear thesis.
- prediction_market candidates include the event, intended side, deadline or resolution window, and requiredRuleOrContractFeatures.
- decision is no_trade only when no candidateExpression deserves configured venue discovery.
- No real venue listing, ticker, contract, odds, price, or liquidity is assumed.

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
}): CassiePromptSpec<z.infer<typeof TradeExpressionPlanSchema>> {
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
- Generate abstract candidateExpressions for venue discovery. Venue search validates real markets later.
- Use tradeExpression.marketDiscovery for shared venue-search state; keep candidateExpressions focused on expression-specific requirements.
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
- directAsset, directAssetTradable, highestPurityExpression, decision, noTradeCase, insufficiency, and marketDiscovery are consistent.
- marketDiscovery describes shared venue-search state; candidateExpressions describe expression-specific requirements.
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
      candidate: assessmentMarketCandidate(input.candidate),
      side: input.side,
    },
    stage: `Tool name: assess_expression_fit
Prompt version: ${PROMPT_VERSION}

Purpose:
Assess whether a real venue candidate correctly expresses the opportunity identified from the tweet.

Role:
Semantic and contract-fit assessor. Decide validated or rejected; do not rank, quote, or re-verify the source claim.

Task:
Determine whether the candidate is validated or rejected.

Rail guidance:
- Crypto: validate when the listed asset, venue side, and intended exposure match the expression.
- Pre-IPO/private stock: validate when the listed pre-stock/private-company market maps to the intended company and side; treat basis, oracle lag, liquidity, or reference-method uncertainty as risk notes, not rejection reasons.
- Public equities, ETFs, commodities, FX, rates, bonds/credit, futures, options/volatility, indices, DeFi yield, baskets, pairs, and multi-leg expressions: validate only when a real configured venue candidate exists and maps to the intended asset/exposure; reject adjacent or unsupported candidates.
- Prediction market: validate when the supplied market resolves the intended event/side closely enough for the expression; reject only when event, side, deadline, or resolution meaning materially differs.

Rules:
- Do not auto-validate any candidate.
- Reject weak proxies unless the causal link is strong.
- Reject candidates that are merely thematically related.
- Reject prediction markets that only share a topic with a continuous price, magnitude, valuation, structural, or untimed thesis.
- Validate cheap prediction-market odds when the market is the right event and side; low price alone is not a mismatch.
- Treat prediction markets as additive when the thesis has both a binary catalyst and a price outcome; assess event purity, not whether it replaces the price expression.
- If venue discovery found a real candidate and it maps to the intended entity/asset/event and side, validate it with fitScore >= 0.7.
- Reject candidates with fitScore < 0.7 when they change the entity, asset, event, side, deadline, payoff, or are merely thematic.
- Do not reject just because secondary documentation, rule text, reference methodology, liquidity depth, or price attractiveness remains imperfect. Put those in basisRisks or requiredFollowUp.
- Do not invent missing rules, specs, or venue data.
- Use a stable candidateId built from venue, symbol/instrument, and side when the input does not provide one.

When uncertain:
- If the candidate is real and maps to the expression's entity/asset/event and side, validate it with fitScore >= 0.7.
- If the candidate cannot be mapped to the intended entity, side, event, or asset exposure, reject it with fitScore < 0.7.
- If the candidate is merely thematically related, reject it instead of treating it as a proxy.
- Use basisRisks and requiredFollowUp for non-blocking caveats; they should not flip a matching venue candidate to rejected.

Examples:
- Candidate is "Will the Fed cut rates at the June FOMC meeting?" for a June rate-cut thesis. Validate if side and deadline match the expression.
- Candidate is "Will the Fed cut rates this year?" for a June-only thesis. Reject it if the broader deadline changes the payoff.
- Candidate is SOL perp for a SOL network-usage thesis. Validate when side and direct asset linkage match and venue data is real.
- Candidate is xyz:MINIMAX pre-stock perp for a long MiniMax private-company valuation expression. Validate it if the symbol maps to MiniMax and side is long; put valuation-reference or liquidity uncertainty in basisRisks/requiredFollowUp.
- Candidate is a thematically related AI market for an NVDA earnings thesis. Reject as weak_proxy or unrelated unless the market directly resolves the earnings event.
- Candidate odds look cheap but the market matches the expression. Validate fit; price attractiveness is not part of this tool.

Before returning, verify internally:
- fitStatus and fitScore agree: validated requires fitScore >= 0.7; rejected requires fitScore < 0.7.
- fitStatus follows entity/asset/event and side mapping, not whether the trade seems attractive.
- sideFit reflects the requested side or outcome token.
- Prediction-market fit checks event wording, side, deadline, and resolution meaning.
- Missing secondary details belong in basisRisks or requiredFollowUp and do not block validation when the venue candidate clearly maps to the expression.
- mismatchReasons name actual mapping mismatches, not vague caution.

${PREDICTION_MARKET_ROUTING_RULES}`,
  });
}
