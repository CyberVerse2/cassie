import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import { InMemoryCassieStore } from "../packages/db/store.ts";
import type {
  GoalResolution,
  QueryJob,
  ResearchQueryPlan,
  ResearchReport,
  SearchResult,
  SignalInterpretation,
  SourcePost,
  SourceProfile,
  Thesis,
} from "../packages/core/schemas/index.ts";
import { normalizeResearchQueryPlan, researchThesis } from "../packages/research/index.ts";

const vagueSignal: SignalInterpretation = {
  signalType: "endorsement",
  containsExplicitThesis: false,
  impliedTheses: [],
  affectedEntities: ["Jeff"],
  affectedSectors: [],
  directTradability: "none",
  suggestedResearchAngles: ["Resolve who is being endorsed and why the source matters."],
  leadQuality: "watchlist",
  summary: "A vague founder endorsement with no direct market expression.",
  confidence: 0.82,
};

const explicitSignal: SignalInterpretation = {
  signalType: "explicit_trade",
  containsExplicitThesis: true,
  impliedTheses: ["SOL ETF approval odds are higher than market pricing."],
  affectedEntities: ["SOL", "Solana ETF"],
  affectedSectors: ["crypto", "ETF"],
  directTradability: "direct",
  suggestedResearchAngles: ["Verify catalyst timeline.", "Estimate whether SOL has priced the event."],
  leadQuality: "tradable_now",
  summary: "An explicit trade idea with a direct liquid expression.",
  confidence: 0.9,
};

const sourcePost: SourcePost = {
  platform: "x",
  postId: "1",
  url: "https://x.com/example/status/1",
  authorHandle: "example",
  authorName: "Example",
  text: "Jeff is shipping something interesting.",
  createdAt: "2026-05-21T00:00:00Z",
};

const thesis: Thesis = {
  claim: "Jeff is shipping something interesting.",
  direction: "unclear",
  mentionedAssets: [],
  topics: ["founder endorsement"],
  timeHorizon: "unclear",
  evidenceQuality: "weak",
  manipulationRisk: "unknown",
  confidence: 0.4,
};

const sourceProfile: SourceProfile = {
  handle: "example",
  displayName: "Example",
  profileUrl: "https://x.com/example",
  bio: null,
  accountType: "analyst",
  credibility: "medium",
  expertise: ["markets"],
  trackRecord: "Limited test profile.",
  networkContext: "Test network context.",
  engagementQuality: "unknown",
  recentRelevantActivity: [],
  redFlags: [],
  unresolvedQuestions: [],
  confidence: 0.6,
};

const researchReport: ResearchReport = {
  claim: thesis.claim,
  normalizedThesis: thesis.claim,
  stance: "unclear",
  evidenceQuality: "insufficient",
  socialContext: {
    momentum: "unknown",
    crowdingSignal: "unknown",
    manipulationSignal: "unknown",
    summary: "Only X provenance was checked.",
  },
  socialSignal: {
    sourceCredibility: "unknown",
    endorserReputation: "Unresolved.",
    entityResolution: {
      resolvedEntity: null,
      confidence: "unknown",
      rationale: "Not enough evidence.",
      unverifiedAssumptions: [],
    },
    personProjectDossier: {
      identifiedPeople: [],
      evidenceSummary: "Unresolved.",
      openQuestions: [],
    },
    smartEngagerSignal: {
      quality: "unknown",
      summary: "Unresolved.",
      notableAccounts: [],
    },
    leadQuality: "watchlist",
    nextResearchActions: [],
  },
  bullCase: [],
  bearCase: [],
  contradictions: [],
  evidence: [],
  warnings: [],
  confidence: 0.3,
  researchConclusion: "insufficient_research",
  recommendedResearchAction: "critic_only",
  publicSummary: "Insufficient research.",
  fullResearchBrief: "Insufficient research.",
};

const goalResolution: GoalResolution = {
  goalId: "g_verify",
  status: "resolved_supported",
  confidence: 0.82,
  supportingEvidenceIds: [],
  contradictingEvidenceIds: [],
  contextualEvidenceIds: [],
  unresolvedQuestions: [],
  summary: "The goal was resolved by wave evidence.",
  synthesisImplication: "The synthesis may treat this goal as supported.",
};

describe("research query planner policy", () => {
  it("caps vague non-tradable signals to source and entity research", () => {
    const plan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: "Jeff is shipping something interesting.",
      signalType: "endorsement",
      mode: "standard",
      assets: [],
      topics: ["founder endorsement"],
      sourceHandle: "source",
      sourceName: "Source",
      scores: {
        specificity: 0.2,
        marketLinkage: 0.1,
        sourceValue: 0.55,
        urgency: 0.2,
        risk: 0.1,
        novelty: 0.5,
        expectedValueOfResearch: 0.4,
      },
      goals: [
        {
          id: "g_source",
          kind: "source_provenance",
          question: "Is the source strong enough to justify a watchlist?",
          decisionUse: "decide_watchlist_priority",
          priority: 0.9,
          mustResolve: true,
          lanes: ["x"],
          evidenceNeeds: ["Author credibility and high-signal engagement."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "The author or engagers have credible relation to the entity.",
            contradictedIf: "The author appears low-signal or promotional.",
            unresolvedIf: "The social context cannot be inspected.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 0 },
          stopWhen: ["source value is too weak"],
        },
        {
          id: "g_entity",
          kind: "entity_resolution",
          question: "Can Jeff and the product be resolved?",
          decisionUse: "route_to_deeper_research",
          priority: 0.85,
          mustResolve: true,
          lanes: ["x", "web"],
          evidenceNeeds: ["Concrete identity for Jeff, firm, or product."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "A concrete person or product is identified.",
            contradictedIf: "The reference is unrelated or promotional.",
            unresolvedIf: "No concrete identity is found.",
          },
          budget: { maxQueries: 3, maxResults: 20, wave: 0 },
          stopWhen: ["entity cannot be resolved"],
        },
        {
          id: "g_trade",
          kind: "trade_expression",
          question: "What is the best trade expression?",
          decisionUse: "identify_trade_expression",
          priority: 0.7,
          mustResolve: false,
          lanes: ["web"],
          evidenceNeeds: ["Liquid instrument or proxy."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "A liquid proxy exists.",
            contradictedIf: "No liquid proxy exists.",
            unresolvedIf: "Market linkage cannot be determined.",
          },
          budget: { maxQueries: 6, maxResults: 30, wave: 1 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "wave 0",
          purpose: "Resolve source and entity.",
          queries: [
            {
              id: "q_source",
              goalIds: ["g_source"],
              lane: "x",
              queryKind: "social_provenance",
              query: "from:source Jeff product shipping",
              priority: 0.9,
              maxResults: 10,
              expectedEvidence: "Author reputation.",
              rationale: "Resolve source value.",
            },
            {
              id: "q_entity",
              goalIds: ["g_entity"],
              lane: "web",
              queryKind: "entity_event",
              query: "\"Jeff\" \"shipping\" \"product\"",
              priority: 0.85,
              maxResults: 10,
              expectedEvidence: "Entity resolution.",
              rationale: "Resolve entity.",
            },
            {
              id: "q_trade",
              goalIds: ["g_trade"],
              lane: "web",
              queryKind: "market_timeseries",
              query: "Jeff product tradable token",
              priority: 0.7,
              maxResults: 10,
              expectedEvidence: "Trade proxy.",
              rationale: "Find trade expression.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_source", "g_entity"],
        cannotConcludeIfUnresolved: ["g_entity"],
      },
    };

    const normalized = normalizeResearchQueryPlan(plan, vagueSignal);

    expect(normalized.mode).toBe("minimal_watchlist");
    expect(normalized.goals.map((goal) => goal.id)).toEqual(["g_source", "g_entity"]);
    expect(normalized.queryBatches.flatMap((batch) => batch.queries).length).toBeLessThanOrEqual(3);
    expect(normalized.queryBatches.flatMap((batch) => batch.queries).map((query) => query.goalIds[0])).not.toContain("g_trade");
    expect(normalized.synthesisContract.cannotConcludeIfUnresolved).toContain("g_entity");
  });

  it("requires disconfirmation for explicit trade ideas", () => {
    const plan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: "SOL ETF approval is underpriced.",
      signalType: "explicit_trade",
      mode: "deep_dive",
      assets: ["SOL"],
      topics: ["Solana ETF"],
      sourceHandle: null,
      sourceName: null,
      scores: {
        specificity: 0.85,
        marketLinkage: 0.9,
        sourceValue: 0.4,
        urgency: 0.6,
        risk: 0.7,
        novelty: 0.5,
        expectedValueOfResearch: 0.8,
      },
      goals: [
        {
          id: "g_catalyst",
          kind: "catalyst_timeline",
          question: "What ETF approval event is being referenced?",
          decisionUse: "validate_or_kill_thesis",
          priority: 0.95,
          mustResolve: true,
          lanes: ["web"],
          evidenceNeeds: ["Primary regulatory or issuer source."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "Active filing or decision date exists.",
            contradictedIf: "No active filing or event exists.",
            unresolvedIf: "Timeline cannot be established.",
          },
          budget: { maxQueries: 4, maxResults: 20, wave: 0 },
          stopWhen: [],
        },
      ],
      queryBatches: [],
      synthesisContract: {
        requiredGoalIds: ["g_catalyst"],
        cannotConcludeIfUnresolved: ["g_catalyst"],
      },
    };

    const normalized = normalizeResearchQueryPlan(plan, explicitSignal);

    expect(normalized.goals.some((goal) => goal.kind === "disconfirmation")).toBe(true);
    expect(normalized.synthesisContract.requiredGoalIds).toContain("g_disconfirmation");
    expect(normalized.synthesisContract.cannotConcludeIfUnresolved).toContain("g_disconfirmation");
  });

  it("injects and runs mandatory web and X lanes even when the planner omits one", async () => {
    const xOnlyPlan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: thesis.claim,
      signalType: "endorsement",
      mode: "minimal_watchlist",
      assets: [],
      topics: thesis.topics,
      sourceHandle: "example",
      sourceName: "Example",
      scores: {
        specificity: 0.2,
        marketLinkage: 0.1,
        sourceValue: 0.55,
        urgency: 0.2,
        risk: 0.1,
        novelty: 0.5,
        expectedValueOfResearch: 0.4,
      },
      goals: [
        {
          id: "g_source",
          kind: "source_provenance",
          question: "Is the source worth tracking?",
          decisionUse: "decide_watchlist_priority",
          priority: 0.9,
          mustResolve: true,
          lanes: ["x"],
          evidenceNeeds: ["Author credibility."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "Author is high signal.",
            contradictedIf: "Author is low signal.",
            unresolvedIf: "Author cannot be evaluated.",
          },
          budget: { maxQueries: 1, maxResults: 10, wave: 0 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "Source provenance",
          purpose: "Check the author.",
          queries: [
            {
              id: "q_source",
              goalIds: ["g_source"],
              lane: "x",
              queryKind: "social_provenance",
              query: "from:example Jeff shipping product",
              priority: 0.9,
              maxResults: 10,
              expectedEvidence: "Author signal.",
              rationale: "The literal post is vague.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_source"],
        cannotConcludeIfUnresolved: ["g_source"],
      },
    };
    let webCalls = 0;
    let xCalls = 0;
    const ai: StructuredAiClient = {
      async generateObject<T>(input: { name: string }) {
        if (input.name === "cassie_source_profile") {
          return sourceProfile as T;
        }
        if (input.name === "cassie_research_query_plan") {
          return xOnlyPlan as T;
        }
        if (input.name === "cassie_goal_resolution") {
          return [goalResolution] as T;
        }
        return researchReport as T;
      },
    };

    await researchThesis({
      ai,
      lanes: {
        async runOpenAiQueryJob() {
          webCalls += 1;
          return { lane: "openai_search", evidence: [], warnings: [], ledger: undefined };
        },
        async runGrokXQueryJob() {
          xCalls += 1;
          return { lane: "x_search", evidence: [], warnings: [], ledger: undefined };
        },
      },
      sourcePost,
      userCommand: "@Cassie critic this",
      signal: vagueSignal,
      thesis,
      researchAngle: "critic",
    });

    expect(webCalls).toBe(1);
    expect(xCalls).toBe(2);
  });

  it("executes research wave by wave and resolves goals after each wave", async () => {
    const twoWavePlan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: "SOL ETF approval is underpriced.",
      signalType: "explicit_trade",
      mode: "deep_dive",
      assets: ["SOL"],
      topics: ["Solana ETF"],
      sourceHandle: "example",
      sourceName: "Example",
      scores: {
        specificity: 0.85,
        marketLinkage: 0.9,
        sourceValue: 0.5,
        urgency: 0.6,
        risk: 0.7,
        novelty: 0.5,
        expectedValueOfResearch: 0.8,
      },
      goals: [
        {
          id: "g_verify",
          kind: "event_validation",
          question: "Is the catalyst real?",
          decisionUse: "validate_or_kill_thesis",
          priority: 0.95,
          mustResolve: true,
          lanes: ["web", "x"],
          evidenceNeeds: ["Primary and social evidence."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "Primary evidence supports it.",
            contradictedIf: "Primary evidence refutes it.",
            unresolvedIf: "Evidence is incomplete.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 0 },
          stopWhen: [],
        },
        {
          id: "g_pricing",
          kind: "market_pricing",
          question: "Is it already priced?",
          decisionUse: "estimate_market_pricing",
          priority: 0.7,
          mustResolve: false,
          lanes: ["web", "x"],
          evidenceNeeds: ["Market and social pricing context."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "Pricing context is found.",
            contradictedIf: "No pricing evidence exists.",
            unresolvedIf: "Pricing context is incomplete.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 1 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "Verify",
          purpose: "Verify the catalyst.",
          queries: [
            {
              id: "q_w0_web",
              goalIds: ["g_verify"],
              lane: "web",
              queryKind: "primary_source",
              query: "Solana ETF official filing",
              priority: 0.95,
              maxResults: 10,
              expectedEvidence: "Official evidence.",
              rationale: "Verify catalyst.",
            },
            {
              id: "q_w0_x",
              goalIds: ["g_verify"],
              lane: "x",
              queryKind: "social_momentum",
              query: "Solana ETF approval source",
              priority: 0.9,
              maxResults: 10,
              expectedEvidence: "Origin social evidence.",
              rationale: "Find source.",
            },
          ],
        },
        {
          wave: 1,
          name: "Pricing",
          purpose: "Check pricing.",
          queries: [
            {
              id: "q_w1_web",
              goalIds: ["g_pricing"],
              lane: "web",
              queryKind: "broad_context",
              query: "SOL ETF priced in",
              priority: 0.7,
              maxResults: 10,
              expectedEvidence: "Pricing evidence.",
              rationale: "Estimate market pricing.",
            },
            {
              id: "q_w1_x",
              goalIds: ["g_pricing"],
              lane: "x",
              queryKind: "social_momentum",
              query: "SOL ETF priced in CT",
              priority: 0.65,
              maxResults: 10,
              expectedEvidence: "Social pricing context.",
              rationale: "Estimate crowding.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_verify"],
        cannotConcludeIfUnresolved: ["g_verify"],
      },
    };
    const calls: string[] = [];
    const resolverInputs: unknown[] = [];
    const ai: StructuredAiClient = {
      async generateObject<T>(input: { name: string; prompt?: string; schema?: { safeParse: (value: unknown) => { success: boolean } } }) {
        if (input.name === "cassie_source_profile") {
          return sourceProfile as T;
        }
        if (input.name === "cassie_research_query_plan") {
          return twoWavePlan as T;
        }
        if (input.name === "cassie_goal_resolution") {
          expect(input.schema?.safeParse({ resolutions: [goalResolution] }).success).toBe(true);
          expect(input.schema?.safeParse([goalResolution]).success).toBe(false);
          resolverInputs.push(input.prompt ?? "");
          return { resolutions: [goalResolution] } as T;
        }
        if (input.name === "cassie_research_report") {
          expect(input.prompt).toContain("goalResolutions");
          expect(input.prompt).toContain("resolved_supported");
          return researchReport as T;
        }
        throw new Error(`Unexpected AI call ${input.name}`);
      },
    };

    await researchThesis({
      ai,
      lanes: {
        async runOpenAiQueryJob(job) {
          calls.push(`webjob:${job.querySpecId}`);
          return { lane: "openai_search", evidence: [], warnings: [], ledger: undefined };
        },
        async runGrokXQueryJob(job) {
          calls.push(`xjob:${job.querySpecId}`);
          return { lane: "x_search", evidence: [], warnings: [], ledger: undefined };
        },
      },
      sourcePost,
      userCommand: "@Cassie trade this",
      signal: explicitSignal,
      thesis,
      researchAngle: "balanced",
    });

    expect(calls).toEqual([
      "xjob:q_source_profile",
      "webjob:q_w0_web",
      "xjob:q_w0_x",
      "webjob:q_w1_web",
      "webjob:q_disconfirm_web",
      "xjob:q_w1_x",
      "xjob:q_disconfirm_x",
    ]);
    expect(resolverInputs).toHaveLength(2);
  });

  it("executes decision-critical queries as atomic jobs and stops after a contradicted required goal", async () => {
    const twoWavePlan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: "Exa raised $250M.",
      signalType: "news",
      mode: "standard",
      assets: [],
      topics: ["AI search", "funding"],
      sourceHandle: "example",
      sourceName: "Example",
      scores: {
        specificity: 0.9,
        marketLinkage: 0.5,
        sourceValue: 0.5,
        urgency: 0.4,
        risk: 0.3,
        novelty: 0.8,
        expectedValueOfResearch: 0.7,
      },
      goals: [
        {
          id: "g_verify_funding",
          kind: "event_validation",
          question: "Did Exa raise $250M?",
          decisionUse: "validate_or_kill_thesis",
          priority: 0.95,
          mustResolve: true,
          lanes: ["web", "x"],
          evidenceNeeds: ["Primary or credible secondary confirmation."],
          disconfirmingQuestions: ["Was the raise denied or misreported?"],
          resolutionCriteria: {
            supportedIf: "Credible evidence confirms the raise.",
            contradictedIf: "Credible evidence refutes the raise.",
            unresolvedIf: "The raise cannot be verified.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 0 },
          stopWhen: ["funding claim is contradicted"],
        },
        {
          id: "g_trade_expression",
          kind: "trade_expression",
          question: "Is there a clean liquid expression?",
          decisionUse: "identify_trade_expression",
          priority: 0.7,
          mustResolve: false,
          lanes: ["web"],
          evidenceNeeds: ["Liquid direct or proxy instrument."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "A clean expression exists.",
            contradictedIf: "No clean expression exists.",
            unresolvedIf: "The expression cannot be resolved.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 1 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "Verify funding",
          purpose: "Verify the core funding event.",
          queries: [
            {
              id: "q_verify_web",
              goalIds: ["g_verify_funding"],
              lane: "web",
              queryKind: "primary_source",
              query: "\"Exa\" \"$250M\" funding",
              priority: 0.95,
              maxResults: 10,
              expectedEvidence: "Primary or credible funding confirmation.",
              rationale: "The research depends on the funding event being real.",
            },
            {
              id: "q_verify_x",
              goalIds: ["g_verify_funding"],
              lane: "x",
              queryKind: "social_provenance",
              query: "\"Exa\" \"$250M\"",
              priority: 0.8,
              maxResults: 10,
              expectedEvidence: "Original social source or refutation.",
              rationale: "X can find origin and refutation signals.",
            },
          ],
        },
        {
          wave: 1,
          name: "Trade expression",
          purpose: "Check whether any public expression exists.",
          queries: [
            {
              id: "q_trade_web",
              goalIds: ["g_trade_expression"],
              lane: "web",
              queryKind: "broad_context",
              query: "Exa AI search public market competitors",
              priority: 0.7,
              maxResults: 10,
              expectedEvidence: "Possible public-market proxies.",
              rationale: "Only run after verification survives.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_verify_funding"],
        cannotConcludeIfUnresolved: ["g_verify_funding"],
      },
    };
    const contradictedResolution: GoalResolution = {
      goalId: "g_verify_funding",
      status: "resolved_contradicted",
      confidence: 0.9,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: ["claim_q_verify_web_1"],
      contextualEvidenceIds: [],
      unresolvedQuestions: [],
      summary: "The funding claim was contradicted.",
      synthesisImplication: "The final synthesis must not treat the raise as verified.",
    };
    const executedJobs: string[] = [];
    const resolverInputs: string[] = [];
    const ai: StructuredAiClient = {
      async generateObject<T>(input: { name: string; prompt?: string }) {
        if (input.name === "cassie_source_profile") {
          return sourceProfile as T;
        }
        if (input.name === "cassie_research_query_plan") {
          return twoWavePlan as T;
        }
        if (input.name === "cassie_goal_resolution") {
          resolverInputs.push(input.prompt ?? "");
          return [contradictedResolution] as T;
        }
        if (input.name === "cassie_research_report") {
          expect(input.prompt).toContain("evidenceLedger");
          expect(input.prompt).toContain("resolved_contradicted");
          expect(input.prompt).toContain("stop_no_trade");
          return researchReport as T;
        }
        throw new Error(`Unexpected AI call ${input.name}`);
      },
    };
    const resultForJob = (job: QueryJob): SearchResult => ({
      id: `result_${job.id}_1`,
      runId: job.runId,
      queryJobId: job.id,
      queryId: job.querySpecId,
      goalIds: job.goalIds,
      wave: job.wave,
      lane: job.lane,
      provider: job.provider,
      title: "Funding result",
      url: "https://example.com/funding",
      canonicalUrl: "https://example.com/funding",
      author: null,
      sourceName: "Example",
      sourceType: "news",
      publishedAt: null,
      retrievedAt: "2026-05-21T00:00:00.000Z",
      rawText: null,
      snippet: "The raise was misreported.",
      rank: 1,
      duplicateOf: null,
      metadata: [],
    });

    await researchThesis({
      ai,
      lanes: {
        async runOpenAiQueryJob(job) {
          executedJobs.push(job.querySpecId);
          return {
            lane: "openai_search",
            evidence: [],
            warnings: [],
            ledger: {
              searchResults: [resultForJob(job)],
              evidenceClaims: [
                {
                  id: `claim_${job.querySpecId}_1`,
                  resultId: `result_${job.id}_1`,
                  queryJobId: job.id,
                  queryId: job.querySpecId,
                  goalIds: job.goalIds,
                  wave: job.wave,
                  claimText: "The raise was misreported.",
                  normalizedClaim: "The funding claim is contradicted.",
                  entities: ["Exa"],
                  assets: [],
                  topics: ["funding"],
                  eventTime: null,
                  claimTimeRelation: "after_signal",
                  sourceType: "news",
                  directness: "direct_secondary",
                  reliability: "high",
                  extractionConfidence: 0.9,
                  quote: "misreported",
                  quoteStartChar: null,
                  quoteEndChar: null,
                },
              ],
              goalEvidenceLinks: [
                {
                  id: `link_${job.querySpecId}_1`,
                  goalId: "g_verify_funding",
                  evidenceClaimId: `claim_${job.querySpecId}_1`,
                  stance: "contradicts",
                  relevance: 0.95,
                  strength: 0.9,
                  reason: "The result directly refutes the funding amount.",
                  satisfiesEvidenceNeeds: ["Primary or credible secondary confirmation."],
                  redFlags: [],
                },
              ],
            },
          };
        },
        async runGrokXQueryJob(job) {
          executedJobs.push(job.querySpecId);
          return {
            lane: "x_search",
            evidence: [],
            warnings: [],
            ledger: {
              searchResults: [resultForJob(job)],
              evidenceClaims: [],
              goalEvidenceLinks: [],
            },
          };
        },
      },
      sourcePost,
      userCommand: "@Cassie think this",
      signal: {
        ...explicitSignal,
        signalType: "news",
        containsExplicitThesis: false,
        leadQuality: "research_lead",
      },
      thesis: { ...thesis, claim: "Exa raised $250M.", topics: ["AI search", "funding"] },
      researchAngle: "balanced",
    });

    expect(executedJobs).toEqual(["q_source_profile", "q_verify_web", "q_verify_x"]);
    expect(executedJobs).not.toContain("q_trade_web");
    expect(resolverInputs[0]).toContain("claim_q_verify_web_1");
  });

  it("runs adaptive follow-up query jobs for unresolved blocking goals before continuing", async () => {
    const queryPlan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: "Exa raised $250M.",
      signalType: "news",
      mode: "standard",
      assets: [],
      topics: ["AI search", "funding"],
      sourceHandle: "example",
      sourceName: "Example",
      scores: {
        specificity: 0.9,
        marketLinkage: 0.5,
        sourceValue: 0.5,
        urgency: 0.4,
        risk: 0.3,
        novelty: 0.8,
        expectedValueOfResearch: 0.7,
      },
      goals: [
        {
          id: "g_verify_funding",
          kind: "event_validation",
          question: "Did Exa raise $250M?",
          decisionUse: "validate_or_kill_thesis",
          priority: 0.95,
          mustResolve: true,
          lanes: ["web"],
          evidenceNeeds: ["Primary or credible secondary confirmation."],
          disconfirmingQuestions: ["Was the raise denied or misreported?"],
          resolutionCriteria: {
            supportedIf: "Credible evidence confirms the raise.",
            contradictedIf: "Credible evidence refutes the raise.",
            unresolvedIf: "The raise cannot be verified.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 0 },
          stopWhen: [],
        },
        {
          id: "g_trade_expression",
          kind: "trade_expression",
          question: "Is there a clean liquid expression?",
          decisionUse: "identify_trade_expression",
          priority: 0.7,
          mustResolve: false,
          lanes: ["web"],
          evidenceNeeds: ["Liquid direct or proxy instrument."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "A clean expression exists.",
            contradictedIf: "No clean expression exists.",
            unresolvedIf: "The expression cannot be resolved.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 1 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "Verify funding",
          purpose: "Verify the core funding event.",
          queries: [
            {
              id: "q_verify_web",
              goalIds: ["g_verify_funding"],
              lane: "web",
              queryKind: "primary_source",
              query: "\"Exa\" \"$250M\" funding",
              priority: 0.95,
              maxResults: 10,
              expectedEvidence: "Primary or credible funding confirmation.",
              rationale: "The research depends on the funding event being real.",
            },
          ],
        },
        {
          wave: 1,
          name: "Trade expression",
          purpose: "Check whether any public expression exists.",
          queries: [
            {
              id: "q_trade_web",
              goalIds: ["g_trade_expression"],
              lane: "web",
              queryKind: "broad_context",
              query: "Exa AI search public market competitors",
              priority: 0.7,
              maxResults: 10,
              expectedEvidence: "Possible public-market proxies.",
              rationale: "Only run after verification survives.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_verify_funding"],
        cannotConcludeIfUnresolved: ["g_verify_funding"],
      },
    };
    const unresolvedResolution: GoalResolution = {
      goalId: "g_verify_funding",
      status: "unresolved",
      confidence: 0.35,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      contextualEvidenceIds: ["claim_q_verify_web_1"],
      unresolvedQuestions: ["No primary confirmation was found."],
      summary: "The funding claim is still unresolved.",
      synthesisImplication: "The synthesis must not treat the funding as verified yet.",
    };
    const supportedResolution: GoalResolution = {
      goalId: "g_verify_funding",
      status: "resolved_supported",
      confidence: 0.86,
      supportingEvidenceIds: ["claim_adaptive_1"],
      contradictingEvidenceIds: [],
      contextualEvidenceIds: [],
      unresolvedQuestions: [],
      summary: "The adaptive query found primary confirmation.",
      synthesisImplication: "The synthesis may treat the funding event as verified.",
    };
    const executedJobs: string[] = [];
    const aiCalls: string[] = [];
    const ai: StructuredAiClient = {
      async generateObject<T>(input: { name: string; prompt?: string }) {
        aiCalls.push(input.name);
        if (input.name === "cassie_source_profile") {
          return sourceProfile as T;
        }
        if (input.name === "cassie_research_query_plan") {
          return queryPlan as T;
        }
        if (input.name === "cassie_goal_resolution") {
          return (input.prompt?.includes("claim_adaptive_1") ? [supportedResolution] : [unresolvedResolution]) as T;
        }
        if (input.name === "cassie_adaptive_query_request") {
          expect(input.prompt).toContain("g_verify_funding");
          expect(input.prompt).toContain("No primary confirmation was found.");
          return {
            requests: [
              {
                unresolvedGoalId: "g_verify_funding",
                evidenceGap: "Need a primary investor or company announcement.",
                whyExistingEvidenceInsufficient: "The first result only gave context.",
                decisionImpact: "could_change_watchlist_to_trade_candidate",
                proposedQueries: [
                  {
                    lane: "web",
                    queryKind: "primary_source",
                    query: "site:exa.ai Exa $250M Series C a16z",
                    expectedEvidence: "Company or investor announcement confirming the round.",
                    maxResults: 5,
                    priority: 0.92,
                    rationale: "Primary confirmation would resolve the blocking goal.",
                  },
                ],
              },
            ],
          } as T;
        }
        if (input.name === "cassie_research_report") {
          expect(input.prompt).toContain("continue_with_adaptive_queries");
          expect(input.prompt).toContain("claim_adaptive_1");
          return researchReport as T;
        }
        throw new Error(`Unexpected AI call ${input.name}`);
      },
    };
    const ledgerFor = (job: QueryJob, claimId: string) => ({
      searchResults: [
        {
          id: `result_${job.id}_1`,
          runId: job.runId,
          queryJobId: job.id,
          queryId: job.querySpecId,
          goalIds: job.goalIds,
          wave: job.wave,
          lane: job.lane,
          provider: job.provider,
          title: "Funding result",
          url: "https://example.com/funding",
          canonicalUrl: "https://example.com/funding",
          author: null,
          sourceName: "Example",
          sourceType: "news" as const,
          publishedAt: null,
          retrievedAt: "2026-05-21T00:00:00.000Z",
          rawText: null,
          snippet: claimId === "claim_adaptive_1" ? "Primary confirmation." : "Context only.",
          rank: 1,
          duplicateOf: null,
          metadata: [],
        },
      ],
      evidenceClaims: [
        {
          id: claimId,
          resultId: `result_${job.id}_1`,
          queryJobId: job.id,
          queryId: job.querySpecId,
          goalIds: job.goalIds,
          wave: job.wave,
          claimText: claimId === "claim_adaptive_1" ? "Exa confirmed a $250M Series C." : "Exa is an AI search company.",
          normalizedClaim: null,
          entities: ["Exa"],
          assets: [],
          topics: ["funding"],
          eventTime: null,
          claimTimeRelation: "after_signal" as const,
          sourceType: "news" as const,
          directness: claimId === "claim_adaptive_1" ? "primary" as const : "context" as const,
          reliability: claimId === "claim_adaptive_1" ? "high" as const : "medium" as const,
          extractionConfidence: 0.86,
          quote: null,
          quoteStartChar: null,
          quoteEndChar: null,
        },
      ],
      goalEvidenceLinks: [
        {
          id: `link_${claimId}`,
          goalId: "g_verify_funding",
          evidenceClaimId: claimId,
          stance: claimId === "claim_adaptive_1" ? "supports" as const : "context" as const,
          relevance: 0.9,
          strength: claimId === "claim_adaptive_1" ? 0.86 : 0.4,
          reason: claimId === "claim_adaptive_1" ? "Primary confirmation." : "Context only.",
          satisfiesEvidenceNeeds: [],
          redFlags: [],
        },
      ],
    });

    await researchThesis({
      ai,
      lanes: {
        async runOpenAiQueryJob(job) {
          executedJobs.push(job.querySpecId);
          return {
            lane: "openai_search",
            evidence: [],
            warnings: [],
            ledger: ledgerFor(job, job.querySpecId.startsWith("q_adaptive") ? "claim_adaptive_1" : "claim_q_verify_web_1"),
          };
        },
        async runGrokXQueryJob(job) {
          expect(job.querySpecId).toBe("q_source_profile");
          return { lane: "x_search", evidence: [], warnings: [], ledger: undefined };
        },
      },
      sourcePost,
      userCommand: "@Cassie think this",
      signal: {
        ...explicitSignal,
        signalType: "news",
        containsExplicitThesis: false,
        leadQuality: "research_lead",
      },
      thesis: { ...thesis, claim: "Exa raised $250M.", topics: ["AI search", "funding"] },
      researchAngle: "balanced",
    });

    expect(executedJobs).toContain("q_verify_web");
    expect(executedJobs).toContain("q_adaptive_g_verify_funding_1_1");
    expect(executedJobs.indexOf("q_adaptive_g_verify_funding_1_1")).toBeLessThan(executedJobs.indexOf("q_trade_web"));
    expect(aiCalls).toContain("cassie_adaptive_query_request");
  });

  it("stops adaptive research when follow-up queries produce no new evidence", async () => {
    const queryPlan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: "Exa raised $250M.",
      signalType: "news",
      mode: "standard",
      assets: [],
      topics: ["AI search", "funding"],
      sourceHandle: "example",
      sourceName: "Example",
      scores: {
        specificity: 0.9,
        marketLinkage: 0.5,
        sourceValue: 0.5,
        urgency: 0.4,
        risk: 0.3,
        novelty: 0.8,
        expectedValueOfResearch: 0.7,
      },
      goals: [
        {
          id: "g_verify_funding",
          kind: "event_validation",
          question: "Did Exa raise $250M?",
          decisionUse: "validate_or_kill_thesis",
          priority: 0.95,
          mustResolve: true,
          lanes: ["web"],
          evidenceNeeds: ["Primary or credible secondary confirmation."],
          disconfirmingQuestions: ["Was the raise denied or misreported?"],
          resolutionCriteria: {
            supportedIf: "Credible evidence confirms the raise.",
            contradictedIf: "Credible evidence refutes the raise.",
            unresolvedIf: "The raise cannot be verified.",
          },
          budget: { maxQueries: 2, maxResults: 20, wave: 0 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "Verify funding",
          purpose: "Verify the core funding event.",
          queries: [
            {
              id: "q_verify_web",
              goalIds: ["g_verify_funding"],
              lane: "web",
              queryKind: "primary_source",
              query: "\"Exa\" \"$250M\" funding",
              priority: 0.95,
              maxResults: 10,
              expectedEvidence: "Primary or credible funding confirmation.",
              rationale: "The research depends on the funding event being real.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_verify_funding"],
        cannotConcludeIfUnresolved: ["g_verify_funding"],
      },
    };
    const unresolvedResolution: GoalResolution = {
      goalId: "g_verify_funding",
      status: "unresolved",
      confidence: 0.35,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      contextualEvidenceIds: [],
      unresolvedQuestions: ["No primary confirmation was found."],
      summary: "The funding claim is still unresolved.",
      synthesisImplication: "The synthesis must not treat the funding as verified yet.",
    };
    const executedJobs: string[] = [];
    const aiCalls: string[] = [];
    const ai: StructuredAiClient = {
      async generateObject<T>(input: { name: string; prompt?: string }) {
        aiCalls.push(input.name);
        if (input.name === "cassie_source_profile") {
          return sourceProfile as T;
        }
        if (input.name === "cassie_research_query_plan") {
          return queryPlan as T;
        }
        if (input.name === "cassie_goal_resolution") {
          return [unresolvedResolution] as T;
        }
        if (input.name === "cassie_adaptive_query_request") {
          return {
            requests: [
              {
                unresolvedGoalId: "g_verify_funding",
                evidenceGap: "Need a primary investor or company announcement.",
                whyExistingEvidenceInsufficient: "No useful evidence was found.",
                decisionImpact: "could_change_watchlist_to_trade_candidate",
                proposedQueries: [
                  {
                    lane: "web",
                    queryKind: "primary_source",
                    query: "site:exa.ai Exa $250M Series C a16z",
                    expectedEvidence: "Company or investor announcement confirming the round.",
                    maxResults: 5,
                    priority: 0.92,
                    rationale: "Primary confirmation would resolve the blocking goal.",
                  },
                ],
              },
            ],
          } as T;
        }
        if (input.name === "cassie_research_report") {
          expect(input.prompt).toContain("stop_watchlist");
          expect(input.prompt).toContain("Adaptive follow-up returned no new evidence");
          return researchReport as T;
        }
        throw new Error(`Unexpected AI call ${input.name}`);
      },
    };

    await researchThesis({
      ai,
      lanes: {
        async runOpenAiQueryJob(job) {
          executedJobs.push(job.querySpecId);
          return {
            lane: "openai_search",
            evidence: [],
            warnings: ["No output generated."],
            ledger: {
              searchResults: [],
              evidenceClaims: [],
              goalEvidenceLinks: [],
            },
          };
        },
        async runGrokXQueryJob(job) {
          expect(job.querySpecId).toBe("q_source_profile");
          return { lane: "x_search", evidence: [], warnings: [], ledger: undefined };
        },
      },
      sourcePost,
      userCommand: "@Cassie critic this",
      signal: {
        ...explicitSignal,
        signalType: "news",
        containsExplicitThesis: false,
        leadQuality: "research_lead",
      },
      thesis: { ...thesis, claim: "Exa raised $250M.", topics: ["AI search", "funding"] },
      researchAngle: "balanced",
    });

    expect(executedJobs).toEqual(["q_verify_web", "q_adaptive_g_verify_funding_1_1"]);
    expect(aiCalls.filter((call) => call === "cassie_adaptive_query_request")).toHaveLength(1);
    expect(aiCalls.filter((call) => call === "cassie_goal_resolution")).toHaveLength(1);
  });

  it("persists query jobs, ledgers, resolutions, and continuation decisions during research", async () => {
    const store = new InMemoryCassieStore();
    const controlRun = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost,
    });
    const queryPlan: ResearchQueryPlan = {
      version: "research-query-plan/v1",
      normalizedClaim: "Exa raised $250M.",
      signalType: "funding",
      mode: "standard",
      assets: [],
      topics: ["AI search", "funding"],
      sourceHandle: "example",
      sourceName: "Example",
      scores: {
        specificity: 0.9,
        marketLinkage: 0.45,
        sourceValue: 0.5,
        urgency: 0.3,
        risk: 0.2,
        novelty: 0.7,
        expectedValueOfResearch: 0.65,
      },
      goals: [
        {
          id: "g_verify",
          kind: "event_validation",
          question: "Did Exa raise $250M?",
          decisionUse: "validate_or_kill_thesis",
          priority: 0.95,
          mustResolve: true,
          lanes: ["web", "x"],
          evidenceNeeds: ["Primary or credible secondary confirmation."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "Funding is confirmed.",
            contradictedIf: "Funding is denied.",
            unresolvedIf: "No credible source confirms it.",
          },
          budget: { maxQueries: 2, maxResults: 10, wave: 0 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "verification",
          purpose: "Verify the funding claim.",
          queries: [
            {
              id: "q_verify_web",
              goalIds: ["g_verify"],
              lane: "web",
              queryKind: "entity_event",
              query: "\"Exa\" \"$250M\" funding",
              priority: 0.95,
              maxResults: 5,
              expectedEvidence: "Funding confirmation.",
              rationale: "Verify the core claim.",
            },
            {
              id: "q_verify_x",
              goalIds: ["g_verify"],
              lane: "x",
              queryKind: "exact_claim",
              query: "\"Exa\" \"$250M\"",
              priority: 0.8,
              maxResults: 5,
              expectedEvidence: "Social confirmation or contradiction.",
              rationale: "Check X context.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_verify"],
        cannotConcludeIfUnresolved: ["g_verify"],
      },
    };
    const ai: StructuredAiClient = {
      async generateObject<T>(input: { name: string }) {
        if (input.name === "cassie_source_profile") return sourceProfile as T;
        if (input.name === "cassie_research_query_plan") return queryPlan as T;
        if (input.name === "cassie_goal_resolution") return [goalResolution] as T;
        if (input.name === "cassie_research_report") return researchReport as T;
        throw new Error(`Unexpected AI call ${input.name}`);
      },
    };

    const runResearch = (controlRunId: string) => researchThesis({
      ai,
      lanes: {
        async runOpenAiQueryJob(job) {
          return {
            lane: "openai_search",
            evidence: [],
            warnings: [],
            ledger: {
              searchResults: [
                {
                  id: `result_${job.id}_1`,
                  runId: job.runId,
                  queryJobId: job.id,
                  queryId: job.querySpecId,
                  goalIds: job.goalIds,
                  wave: job.wave,
                  lane: job.lane,
                  provider: job.provider,
                  title: "Exa raises funding",
                  url: "https://example.com/exa",
                  canonicalUrl: "https://example.com/exa",
                  author: null,
                  sourceName: "Example",
                  sourceType: "news",
                  publishedAt: null,
                  retrievedAt: "2026-05-21T00:00:00.000Z",
                  rawText: null,
                  snippet: "Exa raised $250M.",
                  rank: 1,
                  duplicateOf: null,
                  metadata: [],
                },
              ],
              evidenceClaims: [],
              goalEvidenceLinks: [],
            },
          };
        },
        async runGrokXQueryJob() {
          return { lane: "x_search", evidence: [], warnings: [], ledger: undefined };
        },
      },
      sourcePost,
      userCommand: "@Cassie critic this",
      signal: { ...explicitSignal, signalType: "funding" },
      thesis: { ...thesis, claim: "Exa raised $250M." },
      researchAngle: "critic",
      persistence: {
        store,
        controlRunId,
      },
    });

    await runResearch(controlRun.runId);
    const secondControlRun = await store.createRun({
      userId: "user_1",
      userCommand: "@Cassie critic this again",
      sourcePost,
    });
    await runResearch(secondControlRun.runId);

    const snapshot = await store.load();
    expect(snapshot.researchRuns).toMatchObject([
      { controlRunId: controlRun.runId, status: "succeeded" },
      { controlRunId: secondControlRun.runId, status: "succeeded" },
    ]);
    expect(snapshot.researchQueryJobs.map((job) => job.querySpecId).sort()).toEqual([
      "q_verify_web",
      "q_verify_web",
      "q_verify_x",
      "q_verify_x",
    ]);
    expect(new Set(snapshot.researchQueryJobs.map((job) => job.id)).size).toBe(snapshot.researchQueryJobs.length);
    expect(snapshot.researchSearchResults.map((result) => result.queryId)).toEqual([
      "q_verify_web",
      "q_verify_web",
    ]);
    expect(new Set(snapshot.researchSearchResults.map((result) => result.id)).size).toBe(snapshot.researchSearchResults.length);
    expect(snapshot.researchGoalResolutions.map((resolution) => resolution.goalId)).toEqual(["g_verify", "g_verify"]);
    expect(snapshot.researchContinuationDecisions).toMatchObject([
      { wave: 0, action: "continue_planned" },
      { wave: 0, action: "continue_planned" },
    ]);
  });
});
