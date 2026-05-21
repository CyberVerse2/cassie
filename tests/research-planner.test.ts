import { describe, expect, it } from "vitest";
import type { StructuredAiClient } from "../src/ai.ts";
import type { ResearchQueryPlan, ResearchReport, SignalInterpretation, SourcePost, Thesis } from "../src/schemas.ts";
import { normalizeResearchQueryPlan, researchThesis } from "../src/tools/research.ts";

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

  it("does not run a search lane when the policy-normalized plan has no goals for it", async () => {
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
        return (input.name === "cassie_research_query_plan" ? xOnlyPlan : researchReport) as T;
      },
    };

    await researchThesis({
      ai,
      lanes: {
        async runOpenAiWebSearch() {
          webCalls += 1;
          return { lane: "openai_search", evidence: [], warnings: [] };
        },
        async runGrokXSearch() {
          xCalls += 1;
          return { lane: "x_search", evidence: [], warnings: [] };
        },
      },
      sourcePost,
      userCommand: "@Cassie critic this",
      signal: vagueSignal,
      thesis,
      researchAngle: "critic",
    });

    expect(webCalls).toBe(0);
    expect(xCalls).toBe(1);
  });
});
