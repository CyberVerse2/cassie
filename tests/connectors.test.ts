import { describe, expect, it, vi } from "vitest";
import {
  GrokXSearchLane,
  HyperliquidMarketDataProvider,
  OpenAiWebSearchLane,
  PolymarketMarketDataProvider,
} from "../src/index.js";
import { MissingConnectorConfigError } from "../src/connectors/errors.js";
import type { Thesis } from "../src/schemas.js";
import { buildResearchQueryPlan } from "../src/tools/research.js";

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

describe("research connectors", () => {
  it("requires OpenAI configuration for web search", async () => {
    await expect(new OpenAiWebSearchLane(undefined).run(buildResearchQueryPlan(thesis))).rejects.toBeInstanceOf(
      MissingConnectorConfigError,
    );
  });

  it("requires xAI configuration for X search", async () => {
    await expect(new GrokXSearchLane(undefined).run(buildResearchQueryPlan(thesis))).rejects.toBeInstanceOf(
      MissingConnectorConfigError,
    );
  });
});

describe("market data connectors", () => {
  it("maps Hyperliquid asset contexts into market candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { universe: [{ name: "SOL" }, { name: "BTC" }] },
          [{ dayNtlVlm: "100000000" }, { dayNtlVlm: "1000000000" }],
        ]),
      ),
    );

    const candidates = await new HyperliquidMarketDataProvider("https://example.test/info").findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("hyperliquid");
    expect(candidates[0]?.symbol).toBe("SOL");
    fetchMock.mockRestore();
  });

  it("maps Polymarket markets into prediction-market candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: "1",
            slug: "solana-etf-approved",
            question: "Will a Solana ETF be approved?",
            active: true,
            closed: false,
            liquidityNum: 600000,
          },
        ]),
      ),
    );

    const candidates = await new PolymarketMarketDataProvider("https://example.test/markets").findCandidates({
      thesis,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.venue).toBe("polymarket");
    expect(candidates[0]?.side).toBe("buy_yes");
    fetchMock.mockRestore();
  });
});
