import { describe, expect, it, vi } from "vitest";
import {
  GrokXSearchLane,
  HyperliquidMarketDataProvider,
  OpenAiWebSearchLane,
  PolymarketMarketDataProvider,
} from "../src/index.ts";
import { MissingConnectorConfigError } from "../src/connectors/errors.ts";
import type { ResearchQueryPlan, Thesis } from "../src/schemas.ts";

const thesis: Thesis = {
  claim: "SOL may rally because Solana ETF approval odds are increasing.",
  direction: "bullish",
  mentionedAssets: ["SOL"],
  topics: ["Solana ETF"],
  timeHorizon: "event_based",
  evidenceQuality: "weak",
  manipulationRisk: "medium",
  confidence: 0.8,
};

const queryPlan: ResearchQueryPlan = {
  version: "research-query-plan/v1",
  normalizedClaim: thesis.claim,
  signalType: "rumor",
  mode: "standard",
  assets: thesis.mentionedAssets,
  topics: thesis.topics,
  sourceHandle: "example",
  sourceName: "Example",
  scores: {
    specificity: 0.8,
    marketLinkage: 0.8,
    sourceValue: 0.5,
    urgency: 0.4,
    risk: 0.5,
    novelty: 0.5,
    expectedValueOfResearch: 0.7,
  },
  goals: [
    {
      id: "verify_event",
      kind: "event_validation",
      question: "Verify whether the claimed catalyst is real.",
      decisionUse: "validate_or_kill_thesis",
      priority: 0.9,
      mustResolve: true,
      lanes: ["web", "x"],
      evidenceNeeds: ["Primary or credible secondary source for Solana ETF approval odds."],
      disconfirmingQuestions: ["Is the rumor refuted or stale?"],
      resolutionCriteria: {
        supportedIf: "Credible current evidence confirms the catalyst.",
        contradictedIf: "Primary sources refute or invalidate the catalyst.",
        unresolvedIf: "Only social repetition is available.",
      },
      budget: { maxQueries: 2, maxResults: 20, wave: 0 },
      stopWhen: ["claim is refuted"],
    },
  ],
  queryBatches: [
    {
      wave: 0,
      name: "Catalyst verification",
      purpose: "Verify the Solana ETF catalyst.",
      queries: [
        {
          id: "q_verify_web",
          goalIds: ["verify_event"],
          lane: "web",
          queryKind: "primary_source",
          query: "Solana ETF approval odds official source",
          priority: 0.9,
          maxResults: 10,
          expectedEvidence: "Official or reputable evidence.",
          rationale: "The thesis depends on the catalyst being real.",
        },
        {
          id: "q_verify_x",
          goalIds: ["verify_event"],
          lane: "x",
          queryKind: "social_momentum",
          query: "Solana ETF approval rumor refuted",
          priority: 0.8,
          maxResults: 10,
          expectedEvidence: "Social confirmation or refutation.",
          rationale: "X can surface fast refutations and origin posts.",
        },
      ],
    },
  ],
  synthesisContract: {
    requiredGoalIds: ["verify_event"],
    cannotConcludeIfUnresolved: ["verify_event"],
  },
};

describe("research connectors", () => {
  it("requires OpenAI configuration for web search", async () => {
    await expect(new OpenAiWebSearchLane(undefined).run(queryPlan)).rejects.toBeInstanceOf(
      MissingConnectorConfigError,
    );
  });

  it("requires xAI configuration for X search", async () => {
    await expect(new GrokXSearchLane(undefined).run(queryPlan)).rejects.toBeInstanceOf(
      MissingConnectorConfigError,
    );
  });
});

describe("market data connectors", () => {
  it("maps Hyperliquid asset contexts into market candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { universe: [{ name: "SOL" }, { name: "BTC" }] },
            [{ dayNtlVlm: "100000000" }, { dayNtlVlm: "1000000000" }],
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            levels: [
              [{ px: "99.9", sz: "100" }],
              [{ px: "100.1", sz: "100" }],
            ],
          }),
        ),
      );

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("hyperliquid");
    expect(candidates[0]?.symbol).toBe("SOL");
    expect(candidates[0]?.spreadBps).toBeGreaterThan(0);
    fetchMock.mockRestore();
  });

  it("maps Polymarket markets into prediction-market candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "1",
              slug: "solana-etf-approved",
              question: "Will a Solana ETF be approved?",
              active: true,
              closed: false,
              liquidityNum: 600000,
              clobTokenIds: JSON.stringify(["123", "456"]),
              outcomePrices: JSON.stringify(["0.62", "0.38"]),
              conditionId: "condition_1",
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bids: [{ price: "0.61", size: "100" }],
            asks: [{ price: "0.63", size: "100" }],
          }),
        ),
      );

    const candidates = await new PolymarketMarketDataProvider("https://example.test/markets").findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("polymarket");
    expect(candidates[0]?.side).toBe("buy_yes");
    expect(candidates[0]?.instrument).toBe("solana-etf-approved");
    expect(candidates[0]?.outcomeTokenId).toBe("123");
    expect(candidates[0]?.conditionId).toBe("condition_1");
    fetchMock.mockRestore();
  });
});
