import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_TEST_RUN_TWEETS_PATH = fileURLToPath(
  new URL("../../docs/test-run-tweets.json", import.meta.url),
);

type TweetEntry = {
  url: string;
  current: boolean;
};

type TweetFile = {
  tweets: TweetEntry[];
};

export async function selectNextTweetUrl(filePath = DEFAULT_TEST_RUN_TWEETS_PATH): Promise<string> {
  const tweetFile = parseTweetFile(await readFile(filePath, "utf8"), filePath);
  const currentIndex = tweetFile.tweets.findIndex((tweet) => tweet.current);
  if (currentIndex < 0) {
    throw new Error(`Tweet round-robin file ${filePath} must mark exactly one tweet as current.`);
  }

  if (tweetFile.tweets.some((tweet, index) => index !== currentIndex && tweet.current)) {
    throw new Error(`Tweet round-robin file ${filePath} must mark exactly one tweet as current.`);
  }

  const selected = tweetFile.tweets[currentIndex];
  const nextIndex = (currentIndex + 1) % tweetFile.tweets.length;
  const updated: TweetFile = {
    tweets: tweetFile.tweets.map((tweet, index) => ({
      ...tweet,
      current: index === nextIndex,
    })),
  };
  await writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`);
  return selected.url;
}

function parseTweetFile(raw: string, filePath: string): TweetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Tweet round-robin file ${filePath} is not valid JSON: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.tweets) || parsed.tweets.length === 0) {
    throw new Error(`Tweet round-robin file ${filePath} must contain a non-empty tweets array.`);
  }

  const tweets = parsed.tweets.map((tweet, index) => {
    if (!isRecord(tweet) || typeof tweet.url !== "string" || tweet.url.length === 0 || typeof tweet.current !== "boolean") {
      throw new Error(`Tweet round-robin file ${filePath} has an invalid tweet at index ${index}.`);
    }
    return {
      url: tweet.url,
      current: tweet.current,
    };
  });

  return { tweets };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
