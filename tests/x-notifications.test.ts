import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { ControlRun, Position, TradeExitPlan, TradeTicket } from "../packages/core/schemas/index.ts";
import {
  notifyXTradeShare,
  tradeShareUrl,
  XApiReplyClient,
  type XReplyClient,
} from "../packages/notifications/x.ts";

const exitPlan: TradeExitPlan = {
  takeProfitPct: 10,
  stopLossPct: 5,
  maxHoldDays: 7,
  reviewCadence: "daily",
  thesis: "BTC should continue higher.",
  invalidationSignals: ["BTC loses trend support."],
};

const run: ControlRun = {
  runId: "run_1",
  userId: "user_1",
  userCommand: "@cassiedottrade trade this",
  sourcePost: {
    platform: "x",
    postId: "tweet_1",
    url: "https://x.com/source/status/tweet_1",
    authorHandle: "source",
    authorName: "Source",
    text: "@cassiedottrade trade this",
    createdAt: "2026-06-05T10:00:00.000Z",
    quotedPostText: null,
    linkedUrls: [],
    mediaDescriptions: [],
  },
  status: "succeeded",
  createdAt: "2026-06-05T10:00:00.000Z",
  updatedAt: "2026-06-05T10:00:00.000Z",
  result: { responseType: "trade_ticket" },
  error: null,
};

const ticket: TradeTicket = {
  ticketId: "ticket_1",
  runId: run.runId,
  userId: "user_1",
  thesis: exitPlan.thesis,
  venue: "hyperliquid",
  instrument: "BTC-PERP",
  side: "long",
  sizeUsd: 5,
  orderType: "marketable_limit",
  venueData: { symbol: "BTC" },
  exitPlan,
};

const position: Position = {
  positionId: "position_1",
  userId: "user_1",
  ticketId: ticket.ticketId,
  executionJobId: "job_1",
  venue: "hyperliquid",
  instrument: "BTC-PERP",
  side: "long",
  status: "open",
  entrySizeUsd: 5,
  filledBaseSize: 0.0001,
  filledSizeUsd: 15,
  entryPrice: 60000,
  currentMarkPrice: 60000,
  currentValueUsd: 15,
  unrealizedPnlUsd: 0,
  unrealizedPnlPct: 0,
  exitPlan,
  openedAt: "2026-06-05T10:01:00.000Z",
  updatedAt: "2026-06-05T10:01:00.000Z",
  lastMarkedAt: "2026-06-05T10:01:00.000Z",
  closedAt: null,
  closeExecutionJobId: null,
  failureReason: null,
};

describe("X trade share notifications", () => {
  it("replies once with the public trade share URL", async () => {
    const store = new InMemoryCassieStore();
    const replyClient = new FakeXReplyClient();

    await expect(notifyXTradeShare({ store, run, position, replyClient })).resolves.toBe("sent");
    await expect(notifyXTradeShare({ store, run, position, replyClient })).resolves.toBe("skipped");

    expect(replyClient.replies).toEqual([{
      inReplyToTweetId: "tweet_1",
      text: `Trade is live.\n${tradeShareUrl(position)}`,
    }]);
  });

  it("prefers the persisted webhook mention as the reply target", async () => {
    const store = new InMemoryCassieStore();
    const replyClient = new FakeXReplyClient();
    await store.setRuntimeState(`x_reply_target:${run.runId}`, {
      postId: "mention_1",
      url: "https://x.com/trader/status/mention_1",
    });

    await expect(notifyXTradeShare({ store, run, position, replyClient })).resolves.toBe("sent");

    expect(replyClient.replies).toEqual([{
      inReplyToTweetId: "mention_1",
      text: `Trade is live.\n${tradeShareUrl(position)}`,
    }]);
  });

  it("audits failed X replies without marking them sent", async () => {
    const store = new InMemoryCassieStore();
    const failingReplyClient = new FailingXReplyClient();
    const replyClient = new FakeXReplyClient();

    await expect(notifyXTradeShare({ store, run, position, replyClient: failingReplyClient })).resolves.toBe("failed");
    await expect(notifyXTradeShare({ store, run, position, replyClient })).resolves.toBe("sent");

    const state = await store.load();
    expect(state.auditEvents).toEqual([
      expect.objectContaining({
        entityId: "position_1",
        eventType: "x.trade_share_reply_failed",
      }),
    ]);
    expect(replyClient.replies).toHaveLength(1);
  });

  it("posts replies through the X API v2 create Tweet endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { id: "reply_1" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    const client = new XApiReplyClient("token", fetcher as typeof fetch);

    await expect(client.reply({
      inReplyToTweetId: "tweet_1",
      text: `Trade is live.\n${tradeShareUrl(position)}`,
    })).resolves.toEqual({ tweetId: "reply_1" });

    expect(fetcher).toHaveBeenCalledWith("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: `Trade is live.\n${tradeShareUrl(position)}`,
        reply: { in_reply_to_tweet_id: "tweet_1" },
      }),
    });
  });
});

class FakeXReplyClient implements XReplyClient {
  replies: Array<{ inReplyToTweetId: string; text: string }> = [];

  async reply(input: { inReplyToTweetId: string; text: string }): Promise<{ tweetId: string }> {
    this.replies.push(input);
    return { tweetId: `reply_${this.replies.length}` };
  }
}

class FailingXReplyClient implements XReplyClient {
  async reply(): Promise<{ tweetId: string }> {
    throw new Error("X reply unavailable.");
  }
}
