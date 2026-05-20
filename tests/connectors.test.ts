import { describe, expect, it, vi } from "vitest";
import {
  GrokXSearchLane,
  HyperliquidMarketDataProvider,
  OpenAiWebSearchLane,
  PolymarketMarketDataProvider,
} from "../src/index.ts";
import { MissingConnectorConfigError } from "../src/connectors/errors.ts";
import type { Thesis } from "../src/schemas.ts";
import { buildResearchQueryPlan } from "../src/tools/research.ts";

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
