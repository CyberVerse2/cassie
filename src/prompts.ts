import type { SignalInterpretation, SourcePost, Thesis } from "./schemas.ts";

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
- Is the source credible?
- Is the source a respected builder/operator whose vague endorsement should be treated as a research lead rather than dismissed?
- Did the research verify the source author's reputation, network, and prior products?
- Did the research resolve the relevant person/project/product/entity, or is the match still an inference?
- Are relevant ecosystem surfaces, social profiles, GitHub, docs, contracts, and prior-work signals verified or merely assumed?
- Are smart followers or smart engagers present?
- Is the news already priced in?
- Is the market already crowded?
- Is the ticker ambiguous?
- Is liquidity likely bad?
- Is this a pump?
- Is the opposite trade cleaner?

Return a direct critique. Do not choose order size or execute anything.
Distinguish "not tradable yet" from "worth watchlisting/researching." Do not flatten a high-signal lead into a hard reject just because it is early or vague.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function marketSelectionPrompt(input: {
  thesis: Thesis;
  candidates: unknown[];
  researchReport?: unknown;
}): string {
  return `You are Cassie's market router.

Choose the best market expression for the thesis from the provided candidates.
Rank semantically: thesis fit, directness, liquidity, spread, venue suitability, and whether "no trade" is the best answer.
Do not create a candidate that was not provided.
Do not size the trade. Do not approve execution.

Input:
${JSON.stringify(input, null, 2)}`;
}

export function researchSynthesisPrompt(input: unknown): string {
  return `You are Cassie's Research Subagent synthesis step.

Given a source post, extracted thesis, query plan, and lane evidence, produce a structured ResearchReport.
Separate truth from social momentum. Many X posts repeating the same rumor do not equal many independent sources.
But do not ignore source quality: a vague post from a respected builder/operator can be a valid research lead even when it is not tradable yet.

Required social-intelligence checks:
- Identify who is saying the thing and whether they are credible in the relevant ecosystem.
- Evaluate the source author's reputation, prior products, and network context.
- Resolve the relevant entity explicitly, with confidence and unverified assumptions. The entity may be a person, project, company, protocol, app, token, product, event, or market.
- If the source post does not mention a platform, ecosystem, ticker, or specific project, say that plainly before using inferred evidence.
- Research the person/team/project on X and any relevant ecosystem surfaces when the claim depends on reputation, founder quality, product quality, or network context.
- Look for smart followers/engagers/repliers and summarize whether engagement quality is meaningful.
- Classify leadQuality as ignore, watchlist, research_lead, soft_signal, or tradable_now.
- Give concrete nextResearchActions.

Use recommendedResearchAction, not recommendedTradeAction.
Do not choose markets, size trades, approve orders, or execute anything.

Input:
${JSON.stringify(input, null, 2)}`;
}
