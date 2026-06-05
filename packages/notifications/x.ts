import { config as runtimeConfig } from "../core/config.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { ControlRun, Position } from "../core/schemas/index.ts";

const TRADE_SHARE_BASE_URL = "https://cassie.trade";

export type XReplyClient = {
  reply(input: {
    inReplyToTweetId: string;
    text: string;
  }): Promise<{ tweetId: string }>;
};

type Fetcher = typeof fetch;

export class XApiReplyClient implements XReplyClient {
  constructor(
    private readonly bearerToken = runtimeConfig.x.bearerToken,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async reply(input: { inReplyToTweetId: string; text: string }): Promise<{ tweetId: string }> {
    if (!this.bearerToken) {
      throw new Error("X reply requires X_BEARER_TOKEN with Post write access.");
    }

    const response = await this.fetcher("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        reply: {
          in_reply_to_tweet_id: input.inReplyToTweetId,
        },
      }),
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      throw new Error(`X reply failed with HTTP ${response.status}: ${xPayloadError(payload)}`);
    }
    const tweetId = xCreatedTweetId(payload);
    if (!tweetId) {
      throw new Error("X reply response did not include data.id.");
    }
    return { tweetId };
  }
}

export async function notifyXTradeShare(input: {
  store: CassieStore;
  run: ControlRun | undefined;
  position: Position | null;
  replyClient?: XReplyClient;
}): Promise<"sent" | "skipped" | "failed"> {
  if (!input.position || !input.run || input.run.sourcePost.platform !== "x" || !input.run.sourcePost.postId) {
    return "skipped";
  }

  const stateKey = `x_reply:trade-share:${input.position.positionId}`;
  if (await input.store.getRuntimeState<string>(stateKey)) {
    return "skipped";
  }

  try {
    const replyClient = input.replyClient ?? new XApiReplyClient();
    const reply = await replyClient.reply({
      inReplyToTweetId: input.run.sourcePost.postId,
      text: tradeShareReplyText(input.position),
    });
    await input.store.setRuntimeState(stateKey, reply.tweetId);
    return "sent";
  } catch (error) {
    await input.store.audit({
      entityId: input.position.positionId,
      entityType: "position",
      eventType: "x.trade_share_reply_failed",
      message: "X trade share reply failed.",
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return "failed";
  }
}

export function tradeShareUrl(position: Position): string {
  return new URL(`/trades/${encodeURIComponent(position.positionId)}/pnl`, TRADE_SHARE_BASE_URL).toString();
}

function tradeShareReplyText(position: Position): string {
  return [
    "Trade is live.",
    tradeShareUrl(position),
  ].join("\n");
}

function xCreatedTweetId(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  return typeof payload.data.id === "string" ? payload.data.id : null;
}

function xPayloadError(payload: unknown): string {
  if (isRecord(payload)) {
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.title === "string") return payload.title;
    if (Array.isArray(payload.errors)) return JSON.stringify(payload.errors);
  }
  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
