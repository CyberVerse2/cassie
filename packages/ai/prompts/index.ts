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
Do not create a candidate that was not provided.
Do not size the trade. Do not approve execution.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function tradeExpressionPrompt(input: unknown): string {
  return `You are Cassie's trade-expression planner.

Decide whether the researched signal has a clean monetizable expression.

Evaluate these decision factors:
- what changed
- implied economic claim
- beneficiaries and losers
- most direct asset or exposure
- liquid public, crypto, or prediction-market instrument
- read-through strength
- pricing, crowding, timing, and access constraints

Treat no-trade, watchlist, and private-market research as successful disciplined decisions when the causal chain is weak or the cleanest exposure is inaccessible.
Do not force public tickers, crypto tokens, or prediction markets from indirect read-through.

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
- Use sourceProfile as the primary source-author context when available.
- Use source reputation, founder quality, product quality, network context, and engagement quality only when they affect the claim.
- Classify leadQuality as ignore, watchlist, research_lead, soft_signal, or tradable_now.
- Give concrete nextResearchActions.

Use recommendedResearchAction, not recommendedTradeAction.
Do not choose markets, size trades, approve orders, or execute anything.
Respect goalResolutions. If a required goal is unresolved or contradicted, do not write as if it is resolved. If the trade-expression or market implication goal is unresolved, cap conviction and keep the recommendation in research/critic/watchlist territory.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function sourceProfilePrompt(input: unknown): string {
  return `You are Cassie's source-profile analyst.

Build a compact profile for the author of the source post using only the supplied X evidence.

Profile requirements:
- Identify account type, credibility, expertise, track record, network context, and engagement quality.
- Separate evidence-backed facts from unresolved questions.
- Treat missing profile evidence as unknown instead of guessing.
- Note red flags such as promotional behavior, recycled claims, impersonation risk, or weak provenance.

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

Create an inspectable, goal-first research plan for the source signal.

Design principles:
- Generate goals from the signal type, user command, interpreted thesis, and source context.
- A single post can need several goals: entity resolution, source provenance, social momentum, event validation, technical reality, catalyst timeline, impact materiality, market pricing, second-order implications, risk assessment, disconfirmation, and trade expression.
- Every query must map to at least one explicit goal. No query should exist just because it sounds useful.
- Each must-resolve goal needs concrete evidence needs, resolution criteria, and stop conditions.
- Put queries into wave-based batches. Wave 0 resolves must-answer gating questions. Later waves deepen research only if the signal remains useful.
- Use web for official sources, news, docs, filings, websites, contracts, GitHub, funding, and market/tradability checks.
- Use X for source reputation, original posts, social graph, smart engagers, rumor propagation, refutations, and current discussion.
- Use sourceProfile to calibrate sourceValue, source-provenance goals, and X query priority when available.
- Do not assume an ecosystem, token, platform, or tradable asset unless the signal or prior interpretation supports it.
- Prefer high-priority goals that can invalidate the rest of the research early.
- For vague posts, prefer minimal_watchlist mode and source/entity goals.
- For explicit trade ideas, include at least one disconfirmation goal.

Fill the structured output fields exactly:
- version must be "research-query-plan/v1".
- mode must be minimal_watchlist, standard, deep_dive, or crisis.
- scores should estimate specificity, marketLinkage, sourceValue, urgency, risk, novelty, and expectedValueOfResearch from 0 to 1.
- queryBatches should contain concrete provider-ready web or X queries, each tied to goalIds.
- synthesisContract should name the goals the final synthesis cannot ignore.

Input:
${JSON.stringify(input, null, 2)}`;
}
