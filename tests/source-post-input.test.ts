import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourcePostFromInput } from "../packages/helpers/source-post-input.ts";
import type { SourcePost } from "../packages/core/schemas/index.ts";

const resolvedPost: SourcePost = {
  platform: "x",
  postId: "1",
  url: "https://x.com/a/status/1",
  authorHandle: "a",
  authorName: "A",
  text: "Tweet from the round-robin file.",
  createdAt: "2026-05-24T00:00:00.000Z",
};

describe("source post input", () => {
  it("selects the current round-robin tweet URL when no post text is supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cassie-source-input-"));
    const filePath = join(dir, "tweets.json");
    await writeFile(filePath, JSON.stringify({
      tweets: [
        { url: "https://x.com/a/status/1", current: true },
        { url: "https://x.com/b/status/2", current: false },
      ],
    }, null, 2));
    const resolvedUrls: string[] = [];

    const sourcePost = await sourcePostFromInput({
      tweetsFile: filePath,
      sourceResolver: {
        async resolveSource(input) {
          resolvedUrls.push(input.url);
          return resolvedPost;
        },
      },
    });

    expect(sourcePost).toBe(resolvedPost);
    expect(resolvedUrls).toEqual(["https://x.com/a/status/1"]);
    await expect(currentFlags(filePath)).resolves.toEqual([false, true]);
  });

  it("uses explicit post text without resolving a URL", async () => {
    const sourcePost = await sourcePostFromInput({
      postText: "SOL looks underpriced into ETF approval.",
      sourceResolver: {
        async resolveSource() {
          throw new Error("resolver should not be called");
        },
      },
    });

    expect(sourcePost).toMatchObject({
      text: "SOL looks underpriced into ETF approval.",
      authorHandle: "local-test",
    });
  });
});

async function currentFlags(filePath: string): Promise<boolean[]> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as { tweets: Array<{ current: boolean }> };
  return parsed.tweets.map((tweet) => tweet.current);
}
