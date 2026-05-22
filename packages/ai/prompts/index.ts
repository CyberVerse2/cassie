import type { SignalInterpretation, SourcePost, Thesis } from "../../core/schemas/index.ts";

function postContext(sourcePost: SourcePost, userCommand: string): string {
  return JSON.stringify(
    {
      userCommand,
      sourcePost,
    },
    null,
    2,
  );
}

const sourceQualityPrinciple = `Source-quality principle:
- Evaluate source identity, reputation, track record, network context, and engagement quality when they affect the claim.
- Treat credible but non-tradable signals as research_lead, soft_signal, or watchlist instead of forcing a trade or hard reject.
- Separate independent evidence from repeated social momentum.`;

export function intentRouterPrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): string {
  return `You are Cassie's intent router.

Classify the user command into exactly one supported Cassie intent:
- think: analysis, opinion, "what do you think", find the idea, or market-read requests without explicit trade-ticket language.
- critic: critique, tear down, verify, "is this real", weakness, or skepticism requests.
- trade: create a trade ticket, "get me in", buy/sell/long/short this, or explicit trading requests.
- countertrade: fade, inverse, opposite trade, or countertrade requests.

Use semantic understanding. Do not use keyword-only matching.
If the command is ambiguous, choose the safest supported intent and lower confidence.
Set executionRequested true only when the user is asking for a trade ticket.

Input:
${postContext(input.sourcePost, input.userCommand)}`;
}

export function thesisPrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
  signal: SignalInterpretation;
}): string {
  return `You are Cassie's thesis extractor.

Extract the actual or implied market/research claim from the source post, user command, and signal interpretation.
Do not force every post into an explicit trade thesis. Some posts are raw signals: news, funding, product launches, endorsements, exploits, regulatory updates, or generic opinions.
If there is no explicit thesis, extract the best research question or second-order implication and mark uncertainty clearly.
Focus on what would need to be true in the world for the signal to matter.
Name affected assets and topics when present.
If the post is vague, say so through direction, evidenceQuality, manipulationRisk, and confidence.

Input:
${JSON.stringify(
  {
    userCommand: input.userCommand,
    sourcePost: input.sourcePost,
    signal: input.signal,
  },
  null,
  2,
)}`;
}

export function signalInterpretationPrompt(input: {
  sourcePost: SourcePost;
  userCommand: string;
}): string {
  return `You are Cassie's signal interpreter.

Classify what kind of signal the source post contains before any thesis, research, or market selection.
A post does not need to contain an explicit trade. It may be raw news, a funding announcement, product launch, exploit/risk chatter, regulatory update, endorsement, rumor, social momentum, generic opinion, or noise.

Ask:
- What happened, if anything?
- Is there an explicit thesis, or only an implied research/trading question?
- Which entities, people, products, protocols, companies, tokens, sectors, ecosystems, or markets might be affected?
- Is any implication directly tradable, indirectly tradable, not tradable, or unknown?
- What research angles would a smart analyst investigate next?
- Should this be ignored, watchlisted, treated as a research lead, treated as a soft signal, or considered tradable now?

Be general. Do not assume the domain is crypto unless the post or command points that way.
Do not invent a tradable asset. If the signal is interesting but not tradable, say so.

Input:
${postContext(input.sourcePost, input.userCommand)}`;
}

export function inverseThesisPrompt(input: { thesis: Thesis }): string {
  return `You are Cassie's inverse thesis tool.

Turn the original thesis into the strongest opposing trade idea.
Do not choose a trading venue or order type.
Do not invent certainty. If the inverse is weak or unclear, reflect that in confidence.

Original thesis:
${JSON.stringify(input.thesis, null, 2)}`;
}

export function critiquePrompt(input: {
  thesis: Thesis;
  researchReport: unknown;
}): string {
  return `You are Cassie's critique tool.

Evaluate the thesis after research. Search for weaknesses:
- Source credibility, provenance, reputation, and engagement quality
- Entity resolution and remaining inferred assumptions
- Verification from relevant ecosystem surfaces, docs, contracts, filings, social profiles, GitHub, or prior products
- Is the news already priced in?
- Is the market already crowded?
- Is the ticker ambiguous?
- Is liquidity likely bad?
- Is this a pump?
- Is the opposite trade cleaner?

Evidence-grounding rules:
- Treat the supplied researchReport as the source of truth.
- Do not introduce external facts that contradict resolved researchReport evidence or goal resolutions.
- If researchReport says a filing, ticker, asset mapping, or financial figure is supported, do not call it false unless researchReport itself contains contrary evidence.
- Critique the actual weak links: unsupported valuation inputs, unresolved tradability, crowded positioning, poor liquidity, bad payoff shape, source weakness, or missing price discovery.
- Distinguish "not proven by the filing" from "false."

Return a direct critique. Do not choose order size or execute anything.
Classify credible but non-tradable signals as watchlist or research_lead when appropriate.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function marketSelectionPrompt(input: {
  thesis: Thesis;
  candidates: unknown[];
  researchReport?: unknown;
  tradeExpression?: unknown;
}): string {
  return `You are Cassie's market router.

Choose the best market expression for the thesis from the provided candidates.
Rank semantically: thesis fit, directness, liquidity, spread, venue suitability, and the prior trade-expression plan.
Only choose a market if it matches a tradable-now expression from the trade-expression plan.
If the trade-expression plan contains valuation work, compare each candidate's current price or probability against that fair-value range before selecting.
For pre-stock perps and prediction markets, respect the actual payoff definition: perps express market-implied price discovery, while prediction markets resolve by their stated rules.
Do not create a candidate that was not provided.
Do not size the trade. Do not approve execution.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function tradeExpressionPrompt(input: unknown): string {
  return `You are Cassie's trade-expression planner.

Decide whether the researched signal has a clean monetizable expression.

Return a concrete action path, not a generic summary. The downstream final action must be one of:
no_trade, watchlist, route_to_market, long_perp, short_perp, buy_yes, buy_no, create_ticket, or block_trade.

Evaluate these decision factors:
- what changed
- implied economic claim
- implied valuation, fair value, and market-implied mispricing when the thesis is about valuation, multiples, IPO pricing, market cap, pre-market price, or prediction-market odds
- beneficiaries and losers
- most direct asset or exposure
- liquid public, crypto, pre-stock, synthetic perp, or prediction-market instrument
- read-through strength
- pricing, crowding, timing, and access constraints
- relevant venue checks across Hyperliquid spot/perps/pre-stock perps, Polymarket, public equities/options, crypto spot/perps, and private-only exposure when applicable

Valuation discipline:
- If the signal claims something is overvalued, undervalued, cheap, expensive, mispriced, or priced at a specific market cap or multiple, estimate a fair-value range before deciding the expression.
- Compare fair value to the current or claimed market-implied valuation, price, multiple, or probability.
- If a direct pre-stock perp exists, treat it as the cleanest expression of market-implied price, not as actual equity.
- If a prediction market exists, map the thesis to the exact resolution rule and bracket before choosing YES or NO.
- Do not stop at "the filing numbers are true." Decide whether the market price implied by available venues is too high, too low, or not actionable.
- State what would invalidate the valuation view.
- For each candidate, fill currentMarketPriceOrOdds when known or explicitly state the missing price/odds.
- For each valuation or probability thesis, fill fairValueOrExpectedValue with the model, range, or expected-value comparison used for the decision.
- Fill venueChecks with the exact venues inspected or required before routing.
- Treat SEC/official-filing claims as unverified unless evidence includes the actual regulator/company filing URL or direct filing metadata. News, blogs, and search summaries may support a rumor but must not be upgraded to official filing proof by themselves.

Treat no-trade, watchlist, and private-market research as successful disciplined decisions when the causal chain is weak or the cleanest exposure is inaccessible.
Do not force public tickers, crypto tokens, or prediction markets from indirect read-through.
In the current Cassie market-data surface, route_to_market_router is appropriate only for expressions that can be checked through configured market candidates such as Hyperliquid or Polymarket. Public-equity read-throughs without a configured candidate should be watchlist or no_trade, not route_to_market_router.
For vague sector watchlists or broad macro/sector commentary with no concrete ticker, instrument, catalyst, entry trigger, or venue:
- Set directAsset to null and directAssetTradable to false.
- Use no_trade or watchlist.
- Do not invent a representative index, ETF, stock, token, or option as the instrument.
- If a candidate is needed, use an explicit non-instrument label such as "No concrete instrument" and explain what concrete ticker, venue, level, or catalyst evidence would be required.

Score every candidate from 0 to 1:
- causalDirectness: whether this instrument really expresses the signal
- liquidity: whether the expression can be traded cleanly
- surprise: whether the event was not already known or priced
- timing: whether there is a near-term catalyst
- crowdingRisk: higher means worse
- downsideAsymmetry: higher means better payoff shape
- evidenceQuality: quality of supporting evidence
- expectedEdge: net quality after directness, surprise, timing, evidence, asymmetry, liquidity, and crowding

Use decision:
- route_to_market_router only when at least one liquid candidate is tradable now and has a clean enough causal chain
- watchlist when the signal is meaningful but not yet a trade
- private_market_research when the highest-purity expression is private or access-constrained
- no_trade when the signal is weak, stale, refuted, or too indirect

Input:
${JSON.stringify(input, null, 2)}`;
}

export function researchSynthesisPrompt(input: unknown): string {
  return `You are Cassie's Research Subagent synthesis step.

Given a source post, extracted thesis, query plan, and lane evidence, produce a structured ResearchReport.

${sourceQualityPrinciple}

Synthesis requirements:
- Resolve the relevant person, project, company, protocol, product, event, or market explicitly.
- State confidence and unverified assumptions for inferred entity matches.
- Use decimal scores from 0 to 1 for every relevance, confidence, strength, priority, or similar score field. Do not use 0 to 10 scores or percentages.
- Use sourceProfile as the primary source-author context when available.
- Use source reputation, founder quality, product quality, network context, and engagement quality only when they affect the claim.
- Classify leadQuality as ignore, watchlist, research_lead, soft_signal, or tradable_now.
- Give concrete nextResearchActions.

Use recommendedResearchAction, not recommendedTradeAction.
Do not choose markets, size trades, approve orders, or execute anything.
Respect goalResolutions. If a required goal is unresolved or contradicted, do not write as if it is resolved. If the trade-expression or market implication goal is unresolved, cap conviction and keep the recommendation in research/critic/watchlist territory.
Preserve canonical tool outputs: do not rewrite supported goal resolutions into contradictions, and do not turn a missing venue into "the underlying claim is false" unless evidence actually refutes that claim component.
If a continuation decision blocks trade_expression, market_router, or ticket_creation, set recommendedResearchAction to critic_only or do_not_continue and state the blocked action plainly.
For S-1, IPO, ticker, listing, and regulatory filing claims, separate "reported by news/search result" from "verified in primary SEC/company/exchange filing." Do not call a filing official unless a primary source in the evidence ledger supports it.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function sourceProfilePrompt(input: unknown): string {
  return `You are Cassie's source-profile analyst.

Build a compact profile for the author of the source post using only the supplied X evidence. The X evidence may include results gathered by provider tools before this extraction step.

Profile requirements:
- Identify account basics: profile URL, bio, links, verification, follower/following counts, account age, location signals, and pinned post when visible.
- Identify account type, credibility, expertise, track record, activity, network context, and engagement quality.
- Separate self-claimed expertise from demonstrated output such as code, shipped products, writing, screenshots, collaborations, or other proof-of-work.
- Assess whether the author's reputation and track record should increase or decrease confidence in the specific source-post claim.
- Note promotional behavior, recycled content, inconsistencies, impersonation signals, thin history, protected/deleted history, or unverifiable claims.
- Treat missing profile evidence as low data, not as negative evidence.
- Keep narrative fields concise; target a compact profile rather than an essay.
- Separate evidence-backed facts from unresolved questions.
- Treat missing profile evidence as unknown instead of guessing.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function goalResolutionPrompt(input: unknown): string {
  return `You are Cassie's goal-resolution step.

Resolve each research goal against the wave evidence gathered so far.
Do not synthesize a final trading view. Only decide whether each goal is supported, contradicted, partially resolved, unresolved, or not applicable.
Return an object with a resolutions array.

Rules:
- Use the goal's evidenceNeeds and resolutionCriteria.
- Prefer classified evidenceClaims and goalEvidenceLinks over lane summaries.
- Treat X/social momentum as context unless it directly resolves a social/source goal.
- A must-resolve goal can remain unresolved. Do not force support.
- Contradictions should be explicit because they can stop deeper research or block market routing.
- Include synthesisImplication: what the final research synthesis is allowed or not allowed to conclude from this goal status.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function adaptiveQueryRequestPrompt(input: unknown): string {
  return `You are Cassie's adaptive query controller.

Generate only targeted follow-up queries for unresolved high-impact research goals.
Do not explore broadly. Do not repeat queries that already ran. Do not add curiosity queries.

Rules:
- Propose queries only when the answer could change the final research/trade classification.
- Every proposed query must cite a concrete evidence gap.
- Prefer primary-source, disconfirming, or direct-resolution queries.
- Use web for primary/official/news/docs context and X for origin/social/refutation/source provenance.
- If no useful adaptive query exists, return an empty requests array.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function researchQueryPlanPrompt(input: unknown): string {
  return `You are Cassie's research query planner.

Create an inspectable, decision-first research plan for the source signal.

Cassie is not a generic research bot. Cassie researches so the next step can decide:
- kill_thesis
- support_thesis
- make_conditional
- route_to_trade_expression
- watchlist_only
- block_trade
- needs_more_research

Design principles:
- Decompose the source post into atomic claim components before planning goals.
- Typical components are event existence, entity/ticker mapping, source/provenance, cited numbers, valuation source, valuation math, fair value, current venue price/odds, catalyst timing, tradability, liquidity, and trade expression.
- Generate goals from the signal type, user command, interpreted thesis, source context, and decision state each goal can change.
- Every goal must state the decision it unlocks or blocks. Do not create goals for facts that would not change a research/trade classification.
- Every query must map to at least one explicit goal. No query should exist just because it sounds useful.
- Each must-resolve goal needs concrete evidence needs, resolution criteria, stop conditions, and scoped synthesis implications.
- Put queries into wave-based batches. Wave 0 resolves must-answer gates. Later waves deepen only if the signal remains decision-useful.
- Default to 3-5 initial queries. Use more only for crisis/deep_dive mode or several independent must-resolve gates.
- Prefer primary-source, exchange/venue, market-data, and direct disconfirmation queries over broad context queries.

Scoped disconfirmation:
- Disconfirm exact claim components, not the entire signal unless evidence demands it.
- Separate event_false, entity_false, ticker_false, numbers_false, valuation_source_false, valuation_math_false, valuation_conclusion_false, venue_unavailable, and trade_expression_weak.
- If one component is contradicted, state exactly which downstream conclusions are blocked and which facts may still be true.
- Do not let "not proven by the filing" become "the filing is fake."

Source hierarchy:
- Use primary filings/contracts/docs/company/exchange/venue data first.
- Then use broker/market-data pages, reputable news, and specialist research.
- Use X for source reputation, original posts, social graph, smart engagers, rumor propagation, refutations, and current discussion.
- X can surface a contradiction, but should not overturn a primary filing or venue record unless it points to stronger evidence.
- Use sourceProfile to calibrate sourceValue, source-provenance goals, and X query priority when available.

Venue and trade-expression planning:
- For tradable or valuation-linked signals, include goals for Cassie's actual venue surface when relevant:
  - Hyperliquid spot/perps and pre-stock perps
  - Polymarket prediction markets and resolution rules
  - public equities and listed derivatives
  - crypto spot/perps
  - private-only or inaccessible exposure
- Do not assume a venue exists. Query for it when the thesis or signal suggests direct tradability.
- For prediction markets, map the thesis to the exact market question, outcome side, bracket, and resolution rule.
- For pre-stock perps, treat the instrument as market-implied price discovery, not actual equity.
- For private-company IPO, pre-IPO, or ticker-rumor signals, explicitly include Hyperliquid pre-stock/perp and Polymarket venue checks before concluding that no market route exists.
- For ticker-like strings, add an entity/ticker-collision goal whenever the symbol could refer to a public equity, crypto token, ETF, synthetic perp, or pre-stock instrument.
- For SEC/S-1/listing claims, make the primary-source goal require direct sec.gov, company investor-relations, exchange, or issuer filing evidence. Reputable news can be secondary support but cannot satisfy the official-filing claim alone.

Valuation discipline:
- If the signal claims overvalued, undervalued, cheap, expensive, rich, mispriced, or cites market cap, revenue multiple, EBITDA multiple, IPO valuation, pre-market price, or probability, create goals for:
  - current or claimed market-implied valuation/price/odds
  - fair-value range or valuation framework
  - multiple math and denominator quality
  - source of the valuation input
  - what price, valuation, or odds would invalidate the trade
- Do not stop at verifying that reported numbers are real. The plan must determine whether the market price implied by available venues is too high, too low, or not actionable.

Mode selection:
- Use minimal_watchlist for vague, low-specificity, low-urgency posts.
- Use standard for normal verification plus trade-expression planning.
- Use deep_dive when valuation, legal/regulatory, technical, or multi-venue routing materially affects the decision.
- Use crisis only for time-sensitive exploit, liquidation, regulatory shock, or safety-critical market events.

Fill the structured output fields exactly:
- version must be "research-query-plan/v1".
- mode must be minimal_watchlist, standard, deep_dive, or crisis.
- scores should estimate specificity, marketLinkage, sourceValue, urgency, risk, novelty, and expectedValueOfResearch from 0 to 1.
- queryBatches should contain concrete provider-ready web or X queries, each tied to goalIds.
- synthesisContract should name the goals the final synthesis cannot ignore, facts it may treat as verified, facts it must not contradict, facts that remain conditional, and the exact scope of any disproven claim component.

Input:
${JSON.stringify(input, null, 2)}`;
}
