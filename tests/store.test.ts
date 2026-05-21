import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/db/store.ts";
import type { UserSettings } from "../packages/core/schemas/index.ts";

const settings: UserSettings = {
  userId: "user_1",
  walletAddress: "0x0000000000000000000000000000000000000000",
  allowedVenues: ["hyperliquid"],
  allowedAssets: ["SOL"],
  defaultTradeSizeUsd: 50,
  maxTradeSizeUsd: 100,
  maxDailyLossUsd: 100,
  minConfidence: 0.75,
  maxSpreadBps: 50,
  maxSlippageBps: 100,
  maxPositionUsd: 1_000,
  autoTradeEnabled: false,
};

describe("InMemoryCassieStore", () => {
  it("stores user settings, mentions, runs, and audit events", async () => {
    const store = new InMemoryCassieStore();

    await store.upsertUserSettings(settings);
    const mention = await store.addMention({
      userId: "user_1",
      userCommand: "@Cassie critic this",
      sourcePost: {
        platform: "x",
        postId: "post_1",
        url: null,
        authorHandle: "example",
        authorName: "Example",
        text: "SOL ETF is inevitable.",
        createdAt: null,
      },
    });
    await store.addRun({
      mentionId: mention.mentionId,
      userId: "user_1",
      userCommand: mention.userCommand,
      sourcePost: mention.sourcePost,
      responseType: "critique",
      result: { ok: true },
    });

    const snapshot = await store.load();
    expect(snapshot.userSettings).toHaveLength(1);
    expect(snapshot.mentions).toHaveLength(1);
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.auditEvents.map((event) => event.eventType)).toContain("mention.received");
    expect(snapshot.auditEvents.map((event) => event.eventType)).toContain("run.completed");
  });
});
