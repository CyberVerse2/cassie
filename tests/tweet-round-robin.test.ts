import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectNextTweetUrl } from "../packages/helpers/tweet-round-robin.ts";

describe("tweet round robin", () => {
  it("selects the current tweet and advances the persisted cursor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cassie-tweets-"));
    const filePath = join(dir, "tweets.json");
    await writeFile(filePath, JSON.stringify({
      tweets: [
        { url: "https://x.com/a/status/1", current: true },
        { url: "https://x.com/b/status/2", current: false },
        { url: "https://x.com/c/status/3", current: false },
      ],
    }, null, 2));

    await expect(selectNextTweetUrl(filePath)).resolves.toBe("https://x.com/a/status/1");
    await expect(currentFlags(filePath)).resolves.toEqual([false, true, false]);

    await expect(selectNextTweetUrl(filePath)).resolves.toBe("https://x.com/b/status/2");
    await expect(currentFlags(filePath)).resolves.toEqual([false, false, true]);

    await expect(selectNextTweetUrl(filePath)).resolves.toBe("https://x.com/c/status/3");
    await expect(currentFlags(filePath)).resolves.toEqual([true, false, false]);
  });
});

async function currentFlags(filePath: string): Promise<boolean[]> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as { tweets: Array<{ current: boolean }> };
  return parsed.tweets.map((tweet) => tweet.current);
}
