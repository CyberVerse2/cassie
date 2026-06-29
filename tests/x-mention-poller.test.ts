import { describe, expect, it, vi } from "vitest";
import { pollXCommandMentions } from "../packages/app/x-mention-poller.ts";
import type { CassieProduct } from "../packages/app/product.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import type { XRecentMentionSearchClient, XRecentMentionTweet, XReplyClient } from "../packages/notifications/x.ts";

describe("X mention poller", () => {
  it("creates a run for a connected user command mention", async () => {
    const store = new InMemoryCassieStore();
    await store.upsertUserSettings({
      userId: "did:privy:trader",
      privyUserId: "did:privy:trader",
      privyWalletId: "wallet_1",
      walletAddress: "0xabc",
      profile: { name: "Trader", handle: "@trader", avatarUrl: null },
      x: null,
      defaultTradeSizeUsd: 5,
      telegram: null,
    });
    const createMentionRun = vi.fn(async () => ({ runId: "run_1", status: "queued" as const }));
    const product = { createMentionRun } as unknown as CassieProduct;

    const result = await pollXCommandMentions({
      store,
      product,
      processInitialBackfill: true,
      searchClient: new FakeSearchClient({
        tweets: [{
          id: "2062911914720571795",
          author_id: "1574209048425242624",
          author_name: "Trader",
          author_username: "trader",
          created_at: "2026-06-05T14:58:22.000Z",
          text: "@WatcherGuru @cassiedottrade trade this",
          referenced_tweets: [{ type: "replied_to", id: "2062901896382152804" }],
        }],
        lookupTweets: [{
          id: "2062901896382152804",
          author_id: "1387497871751196672",
          author_name: "Watcher.Guru",
          author_username: "WatcherGuru",
          created_at: "2026-06-05T14:18:34.000Z",
          text: "BitMine shares slide after Ethereum treasury update.",
        }],
      }) as unknown as XRecentMentionSearchClient,
      replyClient: new FakeXReplyClient(),
    });

    expect(result).toMatchObject({ found: 1, processed: 1, skipped: 0, runIds: ["run_1"] });
    expect(createMentionRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: "did:privy:trader",
      userCommand: "@WatcherGuru @cassiedottrade trade this",
      sourcePost: expect.objectContaining({
        postId: "2062901896382152804",
        authorHandle: "WatcherGuru",
        text: "BitMine shares slide after Ethereum treasury update.",
        url: "https://x.com/WatcherGuru/status/2062901896382152804",
      }),
    }));
    await expect(store.getRuntimeState("x_mention_poll:2062911914720571795")).resolves.toMatchObject({
      result: expect.objectContaining({ queued: 1 }),
    });
  });

  it("replies once to an unregistered command mention and dedupes the poll", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn();
    const product = { createMentionRun } as unknown as CassieProduct;
    const searchClient = new FakeSearchClient({ tweets: [{
      id: "2062911914720571795",
      author_id: "1574209048425242624",
      created_at: "2026-06-05T14:58:22.000Z",
      text: "@WatcherGuru @cassiedottrade trade this",
      referenced_tweets: [{ type: "replied_to", id: "2062901896382152804" }],
    }] });
    const replyClient = new FakeXReplyClient();

    const first = await pollXCommandMentions({
      store,
      product,
      processInitialBackfill: true,
      searchClient: searchClient as unknown as XRecentMentionSearchClient,
      replyClient,
    });
    const retry = await pollXCommandMentions({
      store,
      product,
      searchClient: searchClient as unknown as XRecentMentionSearchClient,
      replyClient,
    });

    expect(first).toMatchObject({
      found: 1,
      processed: 1,
      skipped: 0,
      errors: [{ postId: "2062911914720571795", error: "No Cassie account found for X user 1574209048425242624." }],
    });
    expect(retry).toMatchObject({ found: 1, processed: 0, skipped: 1 });
    expect(createMentionRun).not.toHaveBeenCalled();
    expect(replyClient.replies).toEqual([{
      inReplyToTweetId: "2062911914720571795",
      text: "You need to register an account before Cassie can trade for you.\nhttps://cassie.trade",
    }]);
  });

  it("seeds since_id without processing backlog on the first scheduled poll", async () => {
    const store = new InMemoryCassieStore();
    const createMentionRun = vi.fn();
    const replyClient = new FakeXReplyClient();
    const product = { createMentionRun } as unknown as CassieProduct;

    const result = await pollXCommandMentions({
      store,
      product,
      searchClient: new FakeSearchClient({ tweets: [{
        id: "2062911914720571795",
        author_id: "1574209048425242624",
        author_username: "trader",
        text: "@WatcherGuru @cassiedottrade trade this",
      }] }) as unknown as XRecentMentionSearchClient,
      replyClient,
    });

    expect(result).toMatchObject({ found: 1, processed: 0, skipped: 1, runIds: [], errors: [] });
    expect(createMentionRun).not.toHaveBeenCalled();
    expect(replyClient.replies).toEqual([]);
    await expect(store.getRuntimeState("x_mention_poll:since_id")).resolves.toEqual({
      sinceId: "2062911914720571795",
    });
  });

  it("reseeds since_id without processing backlog when X rejects an aged-out cursor", async () => {
    const store = new InMemoryCassieStore();
    await store.setRuntimeState("x_mention_poll:since_id", {
      sinceId: "2065792437612683388",
    });
    const createMentionRun = vi.fn();
    const replyClient = new FakeXReplyClient();
    const product = { createMentionRun } as unknown as CassieProduct;
    const searchClient = new FakeSearchClient({
      staleSinceId: "2065792437612683388",
      tweets: [{
        id: "2069097036665323521",
        author_id: "1574209048425242624",
        author_username: "trader",
        text: "@WatcherGuru @cassiedottrade trade this",
      }],
    });

    const result = await pollXCommandMentions({
      store,
      product,
      searchClient: searchClient as unknown as XRecentMentionSearchClient,
      replyClient,
    });

    expect(result).toMatchObject({ found: 1, processed: 0, skipped: 1, runIds: [], errors: [] });
    expect(searchClient.searches).toEqual([
      { sinceId: "2065792437612683388" },
      {},
    ]);
    expect(createMentionRun).not.toHaveBeenCalled();
    expect(replyClient.replies).toEqual([]);
    await expect(store.getRuntimeState("x_mention_poll:since_id")).resolves.toEqual({
      sinceId: "2069097036665323521",
    });
  });
});

class FakeSearchClient {
  readonly searches: Array<{ sinceId?: string }> = [];

  constructor(private readonly input: {
    tweets: XRecentMentionTweet[];
    lookupTweets?: XRecentMentionTweet[];
    staleSinceId?: string;
  }) {}

  async searchCommandMentions(input: { sinceId?: string } = {}): Promise<XRecentMentionTweet[]> {
    this.searches.push(input);
    if (input.sinceId && input.sinceId === this.input.staleSinceId) {
      throw new Error("X API request failed with HTTP 400: Invalid Request One or more parameters to your request was invalid. [{\"parameters\":{\"since_id\":[\"2065792437612683388\"]},\"message\":\"'since_id' must be a tweet id created after 2026-06-22T16:35Z. Please use a 'since_id' that is larger than 2069097036665323520\"}]");
    }
    return this.input.tweets;
  }

  async lookupTweetsById(ids: string[]): Promise<Map<string, XRecentMentionTweet>> {
    const requested = new Set(ids);
    return new Map((this.input.lookupTweets ?? [])
      .filter((tweet) => requested.has(tweet.id))
      .map((tweet) => [tweet.id, tweet]));
  }
}

class FakeXReplyClient implements XReplyClient {
  replies: Array<{ inReplyToTweetId: string; text: string }> = [];

  async reply(input: { inReplyToTweetId: string; text: string }): Promise<{ tweetId: string }> {
    this.replies.push(input);
    return { tweetId: `reply_${this.replies.length}` };
  }
}
