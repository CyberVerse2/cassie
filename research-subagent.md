# Cassie Research Subagent

The Research Subagent is Cassie's evidence and verification engine. It investigates a thesis and returns structured evidence, goal resolutions, warnings, and a research report. It does not select markets, size trades, approve tickets, or execute orders.

## Boundary

Owns:

```text
claim normalization
research-goal planning
query-job compilation
web/X evidence collection
evidence-ledger classification
goal resolution
adaptive follow-up queries
research synthesis
```

Does not own:

```text
market selection
trade sizing
risk approval
ticket approval
order execution
```

## Workflow

```text
SourcePost + user command + SignalInterpretation + Thesis
-> ResearchQueryPlan
-> QueryJob[]
-> OpenAI web query jobs
-> Grok X query jobs
-> EvidenceLedger
-> GoalResolution[]
-> continuation decision
-> optional adaptive QueryJob[]
-> final ResearchReport
```

The workflow runs wave by wave. After each wave, goal resolutions decide whether to continue, adapt, or stop.

## Query Jobs

Every search is an auditable `QueryJob`.

```text
id
runId
wave
querySpecId
goalIds
lane
provider
query
queryKind
priority
maxResults
expectedEvidence
rationale
```

Web and X lanes execute query jobs directly. The old bundled lane-level search path is not part of the runtime.

## Evidence Ledger

The ledger separates sources, claims, and goal relevance.

```text
SearchResult        raw retrieved source/post/page metadata
EvidenceClaim       specific claim extracted from one result
GoalEvidenceLink    stance of one claim toward one goal
```

This prevents final synthesis from reasoning over undifferentiated search summaries. The final report sees resolved, contradicted, partial, and unresolved goals.

## Lanes

```text
web: OpenAI web search with GPT-5.4 mini
x: Grok 4.3 X search with image/video understanding
```

Web is for primary sources, official statements, filings, news, docs, and direct contradictions. X is for source provenance, social momentum, origin posts, smart engagement, and fast refutations. X can justify priority or watchlisting, but it is not factual proof unless the goal is explicitly social.

## Model Routing

```text
DeepSeek v4 Flash: extraction, tagging, evidence ledger classification
GPT-5.4 mini: web search operator
Grok 4.3: X search and tweet media understanding
GPT-5.5: planning judgment, goal resolution, adaptive search strategy, final synthesis
```

Cheap models do bookkeeping. GPT-5.5 makes analyst judgments.

## Stop Behavior

Research can stop when:

```text
entity resolution fails
required factual premise is contradicted
market linkage is absent
must-resolve goals are resolved
remaining goals are low-impact
adaptive search would not change the decision
```

No-trade and watchlist are valid outputs.
