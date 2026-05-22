import { describe, expect, it } from "vitest";
import { ResearchQueryPlanSchema, ResearchReportSchema, TradeExpressionPlanSchema } from "../packages/core/schemas/index.ts";

describe("schema normalization", () => {
  it("accepts stale 0-to-10 research evidence relevance scores", () => {
    const report = ResearchReportSchema.parse({
      claim: "SPCX is overvalued.",
      normalizedThesis: "SPCX is overvalued.",
      stance: "supported",
      evidenceQuality: "strong",
      socialContext: {
        momentum: "unknown",
        crowdingSignal: "unknown",
        manipulationSignal: "unknown",
        summary: "No social context.",
      },
      socialSignal: {
        sourceCredibility: "unknown",
        endorserReputation: "Unknown.",
        entityResolution: {
          resolvedEntity: null,
          confidence: "unknown",
          rationale: "Unknown.",
          unverifiedAssumptions: [],
        },
        personProjectDossier: {
          identifiedPeople: [],
          evidenceSummary: "Unknown.",
          openQuestions: [],
        },
        smartEngagerSignal: {
          quality: "unknown",
          summary: "Unknown.",
          notableAccounts: [],
        },
        leadQuality: "research_lead",
        nextResearchActions: [],
      },
      bullCase: [],
      bearCase: [],
      contradictions: [],
      evidence: [
        {
          sourceLane: "openai_search",
          sourceType: "regulatory",
          title: "Filing",
          url: "https://example.com",
          author: "SEC",
          publishedAt: "2026-05-20",
          summary: "Filing context.",
          stance: "supports",
          reliability: "high",
          relevance: 10,
          notes: [],
        },
      ],
      warnings: [],
      confidence: 0.8,
      researchConclusion: "claim_likely_true",
      recommendedResearchAction: "critic_only",
      publicSummary: "Supported.",
      fullResearchBrief: "Supported.",
    });

    expect(report.evidence[0]?.relevance).toBe(1);
  });

  it("accepts 0-to-10 query-plan priorities from structured models", () => {
    const plan = ResearchQueryPlanSchema.parse({
      version: "research-query-plan/v1",
      normalizedClaim: "SpaceX IPO valuation is actionable.",
      signalType: "rumor",
      mode: "standard",
      assets: ["SpaceX"],
      topics: ["IPO"],
      sourceHandle: "example",
      sourceName: "Example",
      scores: {
        specificity: 8,
        marketLinkage: 7,
        sourceValue: 3,
        urgency: 2,
        risk: 5,
        novelty: 6,
        expectedValueOfResearch: 9,
      },
      goals: [
        {
          id: "g_venue",
          kind: "trade_expression",
          question: "Does a SpaceX venue exist?",
          decisionUse: "identify_trade_expression",
          priority: 10,
          mustResolve: true,
          lanes: ["web"],
          evidenceNeeds: ["Venue evidence."],
          disconfirmingQuestions: [],
          resolutionCriteria: {
            supportedIf: "Venue exists.",
            contradictedIf: "No direct venue exists.",
            unresolvedIf: "Venue status cannot be established.",
          },
          budget: { maxQueries: 2, maxResults: 10, wave: 0 },
          stopWhen: [],
        },
      ],
      queryBatches: [
        {
          wave: 0,
          name: "Venue checks",
          purpose: "Check venues.",
          queries: [
            {
              id: "q_hl",
              goalIds: ["g_venue"],
              lane: "web",
              queryKind: "market_timeseries",
              query: "Hyperliquid SpaceX pre-stock SPCX",
              priority: 9,
              maxResults: 10,
              expectedEvidence: "Hyperliquid venue data.",
              rationale: "Direct venue availability changes routing.",
            },
          ],
        },
      ],
      synthesisContract: {
        requiredGoalIds: ["g_venue"],
        cannotConcludeIfUnresolved: ["g_venue"],
      },
    });

    expect(plan.scores.specificity).toBe(0.8);
    expect(plan.goals[0]?.priority).toBe(1);
    expect(plan.queryBatches[0]?.queries[0]?.priority).toBe(0.9);
  });

  it("accepts negative expected edge for no-trade candidates", () => {
    const plan = TradeExpressionPlanSchema.parse({
      signal: "ZEC to reach 3-5% of BTC market cap",
      coreInterpretation: "Research refuted the speculative ZEC/BTC pair thesis.",
      directAsset: "ZEC",
      directAssetTradable: true,
      highestPurityExpression: "Long ZEC / short BTC pair",
      publicMarketReadThrough: "none",
      candidates: [
        {
          instrument: "ZECBTC",
          venue: "crypto_spot",
          symbol: "ZECBTC",
          instrumentType: "spot",
          venueQuery: null,
          expression: "no_trade",
          thesis: "Long ZEC against BTC based on BTC holders rebalancing into ZEC.",
          venueChecks: [],
          currentMarketPriceOrOdds: "0.007",
          fairValueOrExpectedValue: "< 0.005",
          causalDirectness: 0.9,
          liquidity: 0.3,
          surprise: 0.1,
          timing: 0.1,
          crowdingRisk: 0.2,
          downsideAsymmetry: 0.1,
          evidenceQuality: 0.2,
          expectedEdge: -0.8,
          tradableNow: false,
          rejectionReason: "The pair has bad expected value.",
          invalidation: ["ZEC/BTC breaks structural resistance."],
          evidenceNeeded: ["Institutional custody adoption."],
        },
      ],
      decision: "no_trade",
      reason: "The trade thesis is structurally unviable.",
      marketRouterInstructions: null,
    });

    expect(plan.candidates[0]?.expectedEdge).toBe(-0.8);
  });
});
