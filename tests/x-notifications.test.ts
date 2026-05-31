import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import { XApi } from "../packages/notifications/x.ts";

describe("X notifications", () => {
  it("posts a reply through the authenticated user token", async () => {
    const fetcher = vi.fn(async () => Response.json({
      data: { id: "reply_1", text: "hi" },
    }, { status: 201 }));
    const gateway = new XApi({
      env: { userAccessToken: "access-token" },
      store: new InMemoryCassieStore(),
      fetcher: fetcher as typeof fetch,
    });

    const result = await gateway.replyToPost({
      postId: "tweet_1",
      text: "hi",
    });

    expect(result).toEqual({ id: "reply_1", text: "hi" });
    expect(fetcher).toHaveBeenCalledWith("https://api.x.com/2/tweets", expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "hi",
        reply: {
          in_reply_to_tweet_id: "tweet_1",
        },
      }),
    }));
  });

  it("refreshes an expired OAuth2 user token and retries once", async () => {
    const store = new InMemoryCassieStore();
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "https://api.x.com/2/oauth2/token") {
        return Response.json({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
        });
      }
      if (fetcher.mock.calls.length === 1) {
        return Response.json({ title: "Unauthorized" }, { status: 401 });
      }
      return Response.json({ data: { id: "reply_1", text: "hi" } }, { status: 201 });
    });
    const gateway = new XApi({
      env: {
        userAccessToken: "expired-access",
        userRefreshToken: "refresh-token",
        oauth2ClientId: "client-id",
        oauth2ClientSecret: "client-secret",
      },
      store,
      fetcher: fetcher as typeof fetch,
    });

    await expect(gateway.replyToPost({
      postId: "tweet_1",
      text: "hi",
    })).resolves.toEqual({ id: "reply_1", text: "hi" });
    expect(await store.getRuntimeState("x.oauth2.user_token")).toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
