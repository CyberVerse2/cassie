import { describe, expect, it } from "vitest";
import { ResearchReportSchema } from "../packages/core/schemas/index.ts";

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
});
