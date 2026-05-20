# Cassie Research Subagent Architecture

## 1. Purpose

The Research Subagent is Cassie's evidence and verification engine.

Given a social post and an extracted thesis, it investigates whether the claim is real, current, credible, contradicted, socially crowded, manipulated, or too uncertain. It returns structured evidence, confidence, risks, and thesis-level judgment.

The Research Subagent does not choose markets, size trades, approve orders, or execute anything.

## 2. Boundary

### Owns

```text
- Understanding and normalizing the claim
- Verifying the claim against external sources
- Searching X/social context
- Checking source quality and recency
- Detecting contradictions
- Detecting rumor, manipulation, and stale-news risk
- Producing bull case and bear case
- Producing confidence, warnings, and a research recommendation
```

### Does Not Own

```text
- Choosing Hyperliquid vs Polymarket vs options
- Choosing perp vs spot vs prediction market
- Choosing long/short/YES/NO
- Choosing order type
- Sizing the trade
- Checking user risk settings
- Approving auto-trading
- Executing orders
```

Downstream ownership:

```text
Research Subagent -> Market Router -> Risk Engine -> Execution Worker
```

## 3. Architecture Role

```text
X/Twitter Mention
-> Cassie Main Agent
-> Intent Router
-> Thesis Extractor
-> Research Subagent
-> Research Report
-> Market Router
-> Risk Engine
-> Trade Ticket / Approval / Execution / No-Trade
```

Cassie Main Agent decides whether deep research is needed. The Research Subagent decides how to investigate the claim. The Market Router later decides whether and how the thesis can be expressed as a trade.

Expose the Research Subagent as a tool:

```ts
researchThesis(input) -> ResearchReport
```

Cassie may call it for prompts like "what do you think?", "critic this", "is this real?", "get me in", "fade this", or "find a market." Even when the user asks to trade, fade, or find a market, this tool only researches.

Recommended implementation:

```text
Cassie Main Agent = ToolLoopAgent
Research Subagent = deterministic workflow + LLM synthesis
Search Lanes = parallel services/tools
Final Output = structured ResearchReport
```

Use one research mode:

```text
mode: deep
researchAngle: balanced | critic | counter
```

## 4. ResearchInput

```ts
type ResearchInput = {
  sourcePost: {
    platform: "x";
    postId: string | null;
    url: string | null;
    authorHandle: string | null;
    authorName: string | null;
    text: string;
    createdAt: string | null;
    quotedPostText?: string | null;
    linkedUrls?: string[];
    mediaDescriptions?: string[];
  };

  userCommand: string;

  extractedThesis: {
    claim: string;
    direction: "bullish" | "bearish" | "neutral" | "unclear";
    mentionedAssets: string[];
    topics: string[];
    timeHorizon:
      | "intraday"
      | "days"
      | "weeks"
      | "months"
      | "event_based"
      | "unclear";
  };

  mode: "deep";
  researchAngle: "balanced" | "critic" | "counter";
};
```

The input may include assets, but the Research Subagent must not decide the trading instrument.

## 5. Research Workflow and Search Lanes

The workflow always runs deep research:

```text
1. Receive ResearchInput
2. Normalize the claim
3. Build a query plan
4. Run OpenAI Search and X Search in parallel
5. Normalize evidence
6. Score source reliability
7. Detect contradictions and uncertainty
8. Detect social momentum and manipulation risk
9. Synthesize ResearchReport
10. Save report to database
11. Return ResearchReport to Cassie Main Agent
```

Search lanes:

```text
Research Subagent
├── OpenAI Search Lane
└── X Search Lane
```

### OpenAI Search Lane

Purpose: external verification.

Answers whether reliable evidence, official sources, reputable news, stale information, or direct refutations exist.

Prioritize official sources, regulatory sources, company announcements, exchange announcements, reliable news, and primary documents.

### X Search Lane

Purpose: social context and narrative investigation.

Answers whether the narrative is spreading, who started it, whether credible accounts are discussing it, whether people are refuting it, whether it looks like a pump or rumor, and whether the same screenshot/link is being recycled.

X Search is social signal, not truth. A popular claim may be crowded or market-moving without being true.

Run both lanes concurrently with `Promise.allSettled` so partial reports can still return:

```ts
async function runResearchWorkflow(input: ResearchInput) {
  const queryPlan = await buildResearchQueryPlan(input);

  const [openAiResult, xResult] = await Promise.allSettled([
    runOpenAIWebSearchLane(queryPlan.openAiQueries),
    runXSearchLane(queryPlan.xQueries),
  ]);

  const evidence = normalizeEvidence({ openAiResult, xResult });

  const report = await synthesizeResearchReport({
    input,
    queryPlan,
    evidence,
  });

  await saveResearchReport(report);

  return report;
}
```

Failure behavior:

```text
If X Search fails:
- Continue with OpenAI Search.
- Add warning: X_SEARCH_FAILED.
- Reduce social confidence.

If OpenAI Search fails:
- Continue with X Search only.
- Add warning: OPENAI_SEARCH_FAILED.
- Do not recommend high-confidence conclusions.

If both fail:
- Return insufficient evidence.
- recommendedResearchAction = insufficient_research.
```

## 6. Query Planning

The Query Planner turns the normalized claim into search queries.

```ts
type ResearchQueryPlan = {
  normalizedClaim: string;
  assets: string[];
  topics: string[];
  openAiQueries: string[];
  xQueries: string[];
  contradictionQueries: string[];
};
```

The plan must include confirmation, official-status, contradiction, and rumor-debunking queries. It must not only search for evidence that supports the original post.

## 7. Evidence, Reliability, and Warnings

Normalize all lane results into one evidence shape:

```ts
type ResearchEvidence = {
  sourceLane: "openai_search" | "x_search";
  sourceType:
    | "official"
    | "regulatory"
    | "company"
    | "exchange"
    | "news"
    | "social"
    | "blog"
    | "unknown";
  title?: string;
  url?: string;
  author?: string;
  publishedAt?: string;
  summary: string;
  stance: "supports" | "refutes" | "mixed" | "unclear";
  reliability: "high" | "medium" | "low";
  relevance: number;
  notes?: string[];
};
```

Reliability order:

```text
1. Official/regulatory source
2. Company or exchange source
3. Reputable news source
4. Known credible analyst/researcher
5. General X/social posts
6. Anonymous or promotional posts
7. Unverifiable screenshots
```

Reliability scoring should consider source type, reputation, recency, primary-source citation, source independence, repeated rumor origin, and promotional incentives.

Important rule:

```text
Many X posts repeating the same rumor do not equal many independent sources.
```

Warnings:

```ts
type ResearchWarning =
  | "NO_PRIMARY_SOURCE"
  | "ONLY_SOCIAL_SOURCES"
  | "UNVERIFIED_SCREENSHOT"
  | "OLD_NEWS_RECIRCULATED"
  | "CLAIM_REFUTED"
  | "CLAIM_PARTIALLY_SUPPORTED"
  | "SOURCE_CONFLICT"
  | "HIGH_SOCIAL_MOMENTUM"
  | "POSSIBLE_COORDINATED_PUSH"
  | "PROMOTIONAL_LANGUAGE"
  | "TICKER_AMBIGUOUS"
  | "LOW_EVIDENCE_QUALITY"
  | "X_SEARCH_FAILED"
  | "OPENAI_SEARCH_FAILED";
```

## 8. ResearchReport Output

The tool must return a structured object:

```ts
type ResearchReport = {
  claim: string;
  normalizedThesis: string;

  stance:
    | "supported"
    | "partially_supported"
    | "refuted"
    | "unverified"
    | "unclear";

  evidenceQuality: "strong" | "medium" | "weak" | "insufficient";

  socialContext: {
    momentum: "low" | "medium" | "high" | "unknown";
    crowdingSignal: "low" | "medium" | "high" | "unknown";
    manipulationSignal: "low" | "medium" | "high" | "unknown";
    summary: string;
  };

  bullCase: string[];
  bearCase: string[];
  contradictions: string[];

  evidence: ResearchEvidence[];
  warnings: ResearchWarning[];

  confidence: number;

  researchConclusion:
    | "claim_likely_true"
    | "claim_plausible_but_unconfirmed"
    | "claim_false_or_refuted"
    | "claim_unclear"
    | "insufficient_research";

  recommendedResearchAction:
    | "proceed_to_market_router"
    | "proceed_with_caution"
    | "critic_only"
    | "insufficient_research"
    | "do_not_continue";

  publicSummary: string;
  fullResearchBrief: string;
};
```

Use `recommendedResearchAction`, not `recommendedTradeAction`.

Action meanings:

```text
proceed_to_market_router
Claim is supported or clear enough for market routing.

proceed_with_caution
Claim may be usable downstream but has meaningful uncertainty.

critic_only
User asked to criticize, not continue toward routing.

insufficient_research
The subagent could not gather enough evidence.

do_not_continue
Claim is refuted, fake, too ambiguous, or clearly manipulative.
```

The public summary should be short enough for an X reply. The full research brief should explain the evidence, contradictions, warnings, and confidence for Cassie's internal UI and downstream systems.

## 9. Persistence

Save every research run for auditability.

Tables:

```text
research_reports: claim, normalized_thesis, stance, evidence_quality, confidence,
research_conclusion, recommended_research_action, public_summary, full_research_brief

research_evidence: research_report_id, source_lane, source_type, title, url,
author, published_at, summary, stance, reliability, relevance

research_warnings: research_report_id, warning
```

## 10. UI Output

Do not expose raw agent logs to users.

Progress states should be clean user-facing labels: reading post, extracting claim, checking web sources, checking X narrative, comparing evidence, and preparing research brief.

Result fields: claim, stance, confidence, evidence quality, bull case, bear case, warnings, public summary, and full research brief.

## 11. MVP Scope

For v1, include:

```text
- Deep claim normalization
- Query planning
- OpenAI Search lane
- X Search lane
- Parallel execution with Promise.allSettled
- Evidence normalization
- Reliability scoring
- Contradiction detection
- Counter angle when requested
- Social momentum/manipulation assessment
- Structured ResearchReport output
- Database persistence
```

Do not include:

```text
- Market selection
- Venue routing
- Trade sizing
- Slippage analysis
- Funding analysis
- Options chain analysis
- Order book analysis
- Execution approval
```

## 12. Example Report

Example input: `Post: "Solana ETF approval is basically inevitable now. Market is asleep." User command: @Cassie get me in`

```json
{
  "claim": "Solana ETF approval is becoming likely",
  "normalizedThesis": "The post claims SOL may benefit because Solana ETF approval odds are increasing.",
  "stance": "partially_supported",
  "socialContext": {
    "momentum": "high",
    "crowdingSignal": "medium",
    "manipulationSignal": "medium",
    "summary": "X discussion is active, but many posts reference the same unconfirmed source."
  },
  "evidenceQuality": "medium",
  "bullCase": ["There is active discussion around Solana ETF filings."],
  "bearCase": ["No primary source confirms approval.", "The narrative may already be crowded."],
  "contradictions": ["Some sources discuss ETF filings, but none confirm approval."],
  "warnings": [
    "NO_PRIMARY_SOURCE",
    "HIGH_SOCIAL_MOMENTUM",
    "CLAIM_PARTIALLY_SUPPORTED"
  ],
  "confidence": 0.62,
  "researchConclusion": "claim_plausible_but_unconfirmed",
  "recommendedResearchAction": "proceed_with_caution",
  "publicSummary": "Plausible but unconfirmed. No primary source found yet, and X momentum is high, so treat this as rumor-driven.",
  "fullResearchBrief": "The claim is directionally plausible because Solana ETF discussion is active, but research did not find primary confirmation of approval. X Search shows high momentum, but much of it appears to reference the same rumor source. Proceed with caution if routing to markets."
}
```
