import { MissingConnectorConfigError } from "../core/helpers/connector-errors.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { XWebhookEnv } from "../core/config.ts";

const X_OAUTH_STATE_KEY = "x.oauth2.user_token";

type XStoredOAuthToken = {
  accessToken: string;
  refreshToken?: string;
  updatedAt: string;
};

type XPostResponse = {
  data?: {
    id?: string;
    text?: string;
  };
  errors?: Array<{ title?: string; detail?: string; status?: number }>;
  title?: string;
  detail?: string;
};

type XRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export type XReplyResult = {
  id: string;
  text: string;
};

export type XReplyGateway = {
  replyToPost(input: {
    postId: string;
    text: string;
  }): Promise<XReplyResult>;
};

export class XApi implements XReplyGateway {
  constructor(
    private readonly options: {
      env: XWebhookEnv;
      store: CassieStore;
      fetcher?: typeof fetch;
    },
  ) {}

  async replyToPost(input: {
    postId: string;
    text: string;
  }): Promise<XReplyResult> {
    return await this.postReply(input, false);
  }

  private async postReply(input: {
    postId: string;
    text: string;
  }, refreshed: boolean): Promise<XReplyResult> {
    const response = await this.fetcher("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.currentAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        reply: {
          in_reply_to_tweet_id: input.postId,
        },
      }),
    });

    if (response.status === 401 && !refreshed) {
      await this.refreshUserToken();
      return await this.postReply(input, true);
    }

    const payload = await response.json().catch(() => null) as XPostResponse | null;
    const id = payload?.data?.id;
    const text = payload?.data?.text;
    if (!response.ok || !id || !text) {
      throw new Error(xApiError("X reply failed", response.status, payload));
    }
    return { id, text };
  }

  private async currentAccessToken(): Promise<string> {
    const stored = await this.options.store.getRuntimeState<XStoredOAuthToken>(X_OAUTH_STATE_KEY);
    const token = stored?.accessToken ?? this.options.env.userAccessToken;
    if (!token) {
      throw new MissingConnectorConfigError("X user posting", "X_USER_ACCESS_TOKEN");
    }
    return token;
  }

  private async refreshUserToken(): Promise<void> {
    const stored = await this.options.store.getRuntimeState<XStoredOAuthToken>(X_OAUTH_STATE_KEY);
    const refreshToken = stored?.refreshToken ?? this.options.env.userRefreshToken;
    if (!refreshToken) {
      throw new MissingConnectorConfigError("X user posting", "X_USER_REFRESH_TOKEN");
    }
    if (!this.options.env.oauth2ClientId) {
      throw new MissingConnectorConfigError("X user posting", "X_OAUTH2_CLIENT_ID");
    }

    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      client_id: this.options.env.oauth2ClientId,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (this.options.env.oauth2ClientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${this.options.env.oauth2ClientId}:${this.options.env.oauth2ClientSecret}`).toString("base64")}`;
    }

    const response = await this.fetcher("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body,
    });
    const payload = await response.json().catch(() => null) as XRefreshResponse | null;
    if (!response.ok || !payload?.access_token) {
      throw new Error(xApiError("X token refresh failed", response.status, payload));
    }
    await this.options.store.setRuntimeState(X_OAUTH_STATE_KEY, {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshToken,
      updatedAt: new Date().toISOString(),
    } satisfies XStoredOAuthToken);
  }

  private get fetcher() {
    return this.options.fetcher ?? fetch;
  }
}

function xApiError(prefix: string, status: number, payload: XPostResponse | XRefreshResponse | null): string {
  if (!payload) return `${prefix} with HTTP ${status}.`;
  const details = "errors" in payload && Array.isArray(payload.errors)
    ? payload.errors.map((error) => error.detail ?? error.title).filter(Boolean).join("; ")
    : undefined;
  const message = details
    ?? ("detail" in payload ? payload.detail : undefined)
    ?? ("error_description" in payload ? payload.error_description : undefined)
    ?? ("error" in payload ? payload.error : undefined)
    ?? ("title" in payload ? payload.title : undefined);
  return message ? `${prefix} with HTTP ${status}: ${message}` : `${prefix} with HTTP ${status}.`;
}
