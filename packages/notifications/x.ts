import { config as runtimeConfig } from "../core/config.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { ControlRun, Position } from "../core/schemas/index.ts";

const TRADE_SHARE_BASE_URL = "https://cassie.trade";
const X_OAUTH_TOKEN_STATE_KEY = "x_oauth2:cassie_user";

export type XReplyClient = {
  reply(input: {
    inReplyToTweetId: string;
    text: string;
  }): Promise<{ tweetId: string }>;
};

type Fetcher = typeof fetch;

export class XApiReplyClient implements XReplyClient {
  constructor(
    private readonly userAccessToken = runtimeConfig.x.userAccessToken,
    private readonly fetcher: Fetcher = fetch,
    private readonly store?: CassieStore,
  ) {}

  async reply(input: { inReplyToTweetId: string; text: string }): Promise<{ tweetId: string }> {
    const payload = await requestXApi({
      url: "https://api.x.com/2/tweets",
      method: "POST",
      tokenName: "X_USER_ACCESS_TOKEN",
      token: await this.currentUserAccessToken(),
      body: JSON.stringify({
        text: input.text,
        reply: {
          in_reply_to_tweet_id: input.inReplyToTweetId,
        },
      }),
      fetcher: this.fetcher,
      refreshUserToken: () => refreshXUserAccessToken({ fetcher: this.fetcher, store: this.store }),
    });
    const tweetId = xCreatedTweetId(payload);
    if (!tweetId) {
      throw new Error("X reply response did not include data.id.");
    }
    return { tweetId };
  }

  private async currentUserAccessToken(): Promise<string | undefined> {
    return (await this.store?.getRuntimeState<XOAuthTokenState>(X_OAUTH_TOKEN_STATE_KEY))?.accessToken
      ?? this.userAccessToken;
  }
}

export type XWebhookConfig = {
  created_at: string;
  id: string;
  url: string;
  valid: boolean;
};

export type XWebhookSyncResult = {
  webhook: XWebhookConfig;
  subscriptionCreated: boolean;
  validationAttempted: boolean;
};

export class XWebhookClient {
  constructor(
    private readonly appBearerToken = runtimeConfig.x.bearerToken,
    private readonly userAccessToken = runtimeConfig.x.userAccessToken,
    private readonly fetcher: Fetcher = fetch,
    private readonly store?: CassieStore,
  ) {}

  async listWebhooks(): Promise<XWebhookConfig[]> {
    const payload = await this.request("https://api.x.com/2/webhooks", {
      method: "GET",
      token: this.appBearerToken,
      tokenName: "X_BEARER_TOKEN",
    });
    if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
    return payload.data.map((item) => xWebhookConfig(item));
  }

  async createWebhook(url: string): Promise<XWebhookConfig> {
    const payload = await this.request("https://api.x.com/2/webhooks", {
      method: "POST",
      token: this.appBearerToken,
      tokenName: "X_BEARER_TOKEN",
      body: { url },
    });
    return xWebhookConfig(payload);
  }

  async validateWebhook(webhookId: string): Promise<boolean> {
    const payload = await this.request(`https://api.x.com/2/webhooks/${encodeURIComponent(webhookId)}`, {
      method: "PUT",
      token: this.appBearerToken,
      tokenName: "X_BEARER_TOKEN",
    });
    return isRecord(payload) && isRecord(payload.data) && payload.data.attempted === true;
  }

  async createAccountActivitySubscription(webhookId: string): Promise<boolean> {
    let payload: unknown;
    try {
      payload = await this.request(
        `https://api.x.com/2/account_activity/webhooks/${encodeURIComponent(webhookId)}/subscriptions/all`,
        {
          method: "POST",
          token: this.userAccessToken,
          tokenName: "X_USER_ACCESS_TOKEN",
          body: {},
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("DuplicateSubscriptionFailed")) return true;
      throw error;
    }
    return isRecord(payload) && isRecord(payload.data) && payload.data.subscribed === true;
  }

  async syncAccountActivityWebhook(input: {
    webhookUrl: string;
    webhookId?: string;
  }): Promise<XWebhookSyncResult> {
    const webhooks = await this.listWebhooks();
    let webhook = input.webhookId
      ? webhooks.find((candidate) => candidate.id === input.webhookId) ?? null
      : webhooks.find((candidate) => candidate.url === input.webhookUrl) ?? null;
    webhook ??= await this.createWebhook(input.webhookUrl);

    const validationAttempted = await this.validateWebhook(webhook.id);
    const subscriptionCreated = await this.createAccountActivitySubscription(webhook.id);
    return { webhook, subscriptionCreated, validationAttempted };
  }

  private async request(url: string, input: {
    method: "GET" | "POST" | "PUT";
    token?: string;
    tokenName: string;
    body?: Record<string, unknown>;
  }): Promise<unknown> {
    return requestXApi({
      url,
      method: input.method,
      tokenName: input.tokenName,
      token: input.tokenName === "X_USER_ACCESS_TOKEN" ? await this.currentUserAccessToken() : input.token,
      body: input.body ? JSON.stringify(input.body) : undefined,
      fetcher: this.fetcher,
      refreshUserToken: () => refreshXUserAccessToken({ fetcher: this.fetcher, store: this.store }),
    });
  }

  private async currentUserAccessToken(): Promise<string | undefined> {
    return (await this.store?.getRuntimeState<XOAuthTokenState>(X_OAUTH_TOKEN_STATE_KEY))?.accessToken
      ?? this.userAccessToken;
  }
}

export async function notifyXTradeShare(input: {
  store: CassieStore;
  run: ControlRun | undefined;
  position: Position | null;
  replyClient?: XReplyClient;
}): Promise<"sent" | "skipped" | "failed"> {
  if (!input.position || !input.run || input.run.sourcePost.platform !== "x") {
    return "skipped";
  }
  const replyTarget = await xReplyTarget(input.store, input.run);
  if (!replyTarget) return "skipped";

  const stateKey = `x_reply:trade-share:${input.position.positionId}`;
  if (await input.store.getRuntimeState<string>(stateKey)) {
    return "skipped";
  }

  try {
    const replyClient = input.replyClient ?? new XApiReplyClient(undefined, fetch, input.store);
    const reply = await replyClient.reply({
      inReplyToTweetId: replyTarget,
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

async function xReplyTarget(store: CassieStore, run: ControlRun): Promise<string | null> {
  const persisted = await store.getRuntimeState<{ postId?: unknown }>(`x_reply_target:${run.runId}`);
  if (typeof persisted?.postId === "string" && persisted.postId.length > 0) return persisted.postId;
  return run.sourcePost.postId;
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

function xWebhookConfig(payload: unknown): XWebhookConfig {
  if (!isRecord(payload)) throw new Error("X webhook response did not include a webhook config.");
  const id = typeof payload.id === "string" ? payload.id : null;
  const url = typeof payload.url === "string" ? payload.url : null;
  const createdAt = typeof payload.created_at === "string" ? payload.created_at : null;
  const valid = typeof payload.valid === "boolean" ? payload.valid : null;
  if (!id || !url || !createdAt || valid == null) {
    throw new Error("X webhook response did not include id, url, created_at, and valid.");
  }
  return { id, url, created_at: createdAt, valid };
}

type XOAuthTokenState = {
  accessToken: string;
  refreshToken?: string;
  refreshedAt: string;
};

async function requestXApi(input: {
  url: string;
  method: "GET" | "POST" | "PUT";
  token?: string;
  tokenName: string;
  body?: string;
  fetcher: Fetcher;
  refreshUserToken?: () => Promise<string>;
}): Promise<unknown> {
  if (!input.token) {
    throw new Error(`X API request requires ${input.tokenName}.`);
  }
  const first = await fetchXApi(input, input.token);
  if (first.response.status !== 401 || input.tokenName !== "X_USER_ACCESS_TOKEN" || !input.refreshUserToken) {
    return payloadOrThrow(first.response, first.payload);
  }
  const refreshedToken = await input.refreshUserToken();
  const second = await fetchXApi(input, refreshedToken);
  return payloadOrThrow(second.response, second.payload);
}

async function fetchXApi(input: {
  url: string;
  method: "GET" | "POST" | "PUT";
  body?: string;
  fetcher: Fetcher;
}, token: string): Promise<{ response: Response; payload: unknown }> {
  const response = await input.fetcher(input.url, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body,
  });
  const payload = await response.json().catch(() => null) as unknown;
  return { response, payload };
}

function payloadOrThrow(response: Response, payload: unknown): unknown {
  if (!response.ok) {
    throw new Error(`X API request failed with HTTP ${response.status}: ${xPayloadError(payload)}`);
  }
  return payload;
}

async function refreshXUserAccessToken(input: {
  fetcher: Fetcher;
  store?: CassieStore;
}): Promise<string> {
  const stored = await input.store?.getRuntimeState<XOAuthTokenState>(X_OAUTH_TOKEN_STATE_KEY);
  const refreshToken = stored?.refreshToken ?? runtimeConfig.x.userRefreshToken;
  if (!runtimeConfig.x.oauth2ClientId || !runtimeConfig.x.oauth2ClientSecret || !refreshToken) {
    throw new Error("X user token refresh requires X_OAUTH2_CLIENT_ID, X_OAUTH2_CLIENT_SECRET, and X_USER_REFRESH_TOKEN.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await input.fetcher("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${runtimeConfig.x.oauth2ClientId}:${runtimeConfig.x.oauth2ClientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new Error(`X user token refresh failed with HTTP ${response.status}: ${xPayloadError(payload)}`);
  }
  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    throw new Error("X user token refresh response did not include access_token.");
  }

  const state: XOAuthTokenState = {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken,
    refreshedAt: new Date().toISOString(),
  };
  await input.store?.setRuntimeState(X_OAUTH_TOKEN_STATE_KEY, state);
  return state.accessToken;
}

function xPayloadError(payload: unknown): string {
  if (isRecord(payload)) {
    const parts = [
      typeof payload.title === "string" ? payload.title : null,
      typeof payload.detail === "string" ? payload.detail : null,
      Array.isArray(payload.errors) ? JSON.stringify(payload.errors) : null,
    ].filter((part) => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
