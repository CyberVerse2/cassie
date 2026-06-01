import { describe, expect, it } from "vitest";
import {
  compactTradeCardThesisDetails,
  positionToTradeShareData,
  type TradeCardThesisDetails,
} from "../apps/web/app/lib/trade-card-data.ts";
import type { StructuredAiClient } from "../packages/ai/client.ts";
import type { ControlRun, Position, RunStep, TradeTicket } from "../packages/core/schemas/index.ts";

const ticket: TradeTicket = {
  ticketId: "ticket_1",
  runId: "run_1",
  userId: "user_1",
  thesis: "BTC breaks higher if the $65k level holds.",
  venue: "polymarket",
  instrument: "prediction_market",
  side: "buy_yes",
  sizeUsd: 50,
  orderType: "marketable_limit",
  venueData: {
    symbol: "BTC-75K",
    conditionId: "condition_1",
    outcomeTokenId: "token_1",
  },
  exitPlan: {
    takeProfitPct: 10,
    stopLossPct: 5,
    maxHoldDays: 7,
    reviewCadence: "daily",
    thesis: "BTC breaks higher if the $65k level holds.",
    invalidationSignals: ["BTC loses $65k."],
  },
};

const position: Position = {
  positionId: "position_1",
  userId: "user_1",
  ticketId: "ticket_1",
  executionJobId: "job_1",
  venue: "polymarket",
  instrument: "prediction_market",
  side: "buy_yes",
  status: "open",
  entrySizeUsd: 50,
  filledSizeUsd: 50,
  entryPrice: 0.52,
  currentMarkPrice: 0.71,
  currentValueUsd: 68.27,
  unrealizedPnlUsd: 18.27,
  unrealizedPnlPct: 36.5,
  exitPlan: ticket.exitPlan,
  openedAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T09:00:00.000Z",
  lastMarkedAt: "2026-06-01T09:00:00.000Z",
  closedAt: null,
  closeExecutionJobId: null,
  failureReason: null,
};

const run: ControlRun = {
  runId: "run_1",
  userId: "user_1",
  userCommand: "@Cassie trade this",
  sourcePost: {
    platform: "x",
    postId: "post_1",
    url: "https://x.com/source/status/post_1",
    authorHandle: "source",
    authorName: "Source",
    text: "As long as BTC holds $65k, I think $75k trades next.",
    createdAt: "2026-05-31T12:00:00.000Z",
    quotedPostText: null,
    linkedUrls: [],
    mediaDescriptions: [],
  },
  status: "succeeded",
  result: null,
  error: null,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:01:00.000Z",
};

const steps: RunStep[] = [
  {
    stepId: "step_1",
    runId: "run_1",
    stepType: "intake",
    status: "succeeded",
    input: null,
    output: {
      headlineThesis: "Google is behind in the AI race despite having vast data.",
    },
    error: null,
    model: null,
    promptName: null,
    promptVersion: null,
    thinkingTrace: null,
    startedAt: "2026-06-01T08:00:00.000Z",
    completedAt: "2026-06-01T08:00:01.000Z",
  },
];

describe("trade card data", () => {
  it("maps a persisted position and ticket into share-card data", () => {
    const thesisDetails: TradeCardThesisDetails = {
      signal: "As long as BTC holds $65k, I think $75k trades next.",
      why: "BTC breaks higher if the $65k level holds.",
      invalidation: "BTC loses $65k.",
    };
    const share = positionToTradeShareData({ position, ticket, run, thesisDetails });

    expect(share.title).toBe("BTC-75K YES +36.5%");
    expect(share.pnlLabel).toBe("Unrealized PnL");
    expect(share.entryLabel).toBe("52c");
    expect(share.exitLabel).toBe("71c");
    expect(share.cardProps.author?.name).toBe("@source");
    expect(share.cardProps.headline).toBe("As long as BTC holds $65k, I think $75k trades next.");
    expect(share.cardProps.thesis).toEqual([
      { label: "Signal", text: "As long as BTC holds $65k, I think $75k trades next." },
      { label: "Why", text: "BTC breaks higher if the $65k level holds." },
      { label: "Invalidation", text: "BTC loses $65k." },
    ]);
    expect(share.cardProps.market).toMatchObject({
      venue: "Polymarket",
      side: "YES",
      entry: "52c",
      exit: "71c",
    });
  });

  it("uses AI-compacted thesis details for the share card", async () => {
    let prompt = "";
    const ai: StructuredAiClient = {
      async generateObject<T>(input: Parameters<StructuredAiClient["generateObject"]>[0]): Promise<T> {
        expect(input.name).toBe("cassie_trade_card_thesis_compaction");
        expect(input.system).toContain("Do not include venue names, ticker symbols");
        prompt = input.prompt;
        return {
          signal: "Google is behind in the AI race despite having vast data.",
          why: "Short Alphabet on bearish Google AI-leadership weakness.",
          invalidation: "Alphabet sentiment improves on credible AI product traction re-rating.",
        } as T;
      },
    };
    const hyperliquidTicket: TradeTicket = {
      ...ticket,
      venue: "hyperliquid",
      instrument: "synthetic_perp",
      side: "short",
      venueData: { symbol: "xyz:GOOGL", markPrice: 379.83 },
      thesis: "Best direct short expression with highest liquidity and low spread.",
      exitPlan: {
        ...ticket.exitPlan,
        thesis: "Short Alphabet/GOOGL on the market's bearish read-through that Google is lagging in the AI race; the trade is a direct sentiment expression on Google AI-leadership weakness.",
        invalidationSignals: [
          "Alphabet sentiment improves on credible AI product/traction re-rating",
        ],
      },
    };
    const thesisDetails = await compactTradeCardThesisDetails({
      run,
      steps,
      ticket: hyperliquidTicket,
      ai,
    });
    const share = positionToTradeShareData({
      position: {
        ...position,
        venue: "hyperliquid",
        instrument: "synthetic_perp",
        side: "short",
        entryPrice: 379.83,
        currentMarkPrice: 361.44,
      },
      ticket: hyperliquidTicket,
      run,
      steps,
      thesisDetails,
    });

    expect(prompt).toContain("xyz:GOOGL");
    expect(prompt).toContain("Google is behind in the AI race despite having vast data.");
    expect(share.cardProps.thesis).toEqual([
      { label: "Signal", text: "Google is behind in the AI race despite having vast data." },
      { label: "Why", text: "Short Alphabet on bearish Google AI-leadership weakness." },
      { label: "Invalidation", text: "Alphabet sentiment improves on credible AI product traction re-rating." },
    ]);
  });
});
