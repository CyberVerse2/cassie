import { describe, expect, it, vi } from "vitest";
import type { CassieAuth } from "../packages/adapters/auth/better-auth.ts";
import {
  authenticateRequest,
  resolveXSessionSettings,
} from "../packages/adapters/auth/session.ts";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";

const profile = { name: "Cassie", handle: "cassie", avatarUrl: null };

function fakeAuth(session: unknown): CassieAuth {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(session),
    },
  } as unknown as CassieAuth;
}

function cookieRequest(): Request {
  return new Request("http://localhost/api/account", {
    headers: { cookie: "better-auth.session_token=token" },
  });
}

describe("X session resolution", () => {
  it("matches an existing user by stored X user id", async () => {
    const store = new InMemoryCassieStore();
    await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile,
      x: { userId: "x_123", username: "cassie" },
    });

    const settings = await resolveXSessionSettings(store, {
      xUserId: "x_123",
      xUsername: "cassie",
      name: "Cassie",
      image: null,
    });

    expect(settings.userId).toBe("did:privy:user_1");
    expect(settings.privyWalletId).toBe("wallet_1");
  });

  it("matches by username when the X user id was never stored, and backfills it", async () => {
    const store = new InMemoryCassieStore();
    await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile,
      x: { userId: null, username: "cassie" },
    });

    const settings = await resolveXSessionSettings(store, {
      xUserId: "x_123",
      xUsername: "cassie",
      name: "Cassie",
      image: null,
    });

    expect(settings.userId).toBe("did:privy:user_1");
    expect(settings.x).toEqual({ userId: "x_123", username: "cassie" });
    await expect(
      store.getUserSettingsByXIdentity({ userId: "x_123" }),
    ).resolves.toMatchObject({ userId: "did:privy:user_1" });
  });

  it("matches by profile handle when no x identity was stored", async () => {
    const store = new InMemoryCassieStore();
    await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: { ...profile, handle: "@cassie" },
    });

    const settings = await resolveXSessionSettings(store, {
      xUserId: "x_123",
      xUsername: "cassie",
      name: "Cassie",
      image: null,
    });

    expect(settings.userId).toBe("did:privy:user_1");
    expect(settings.x).toEqual({ userId: "x_123", username: "cassie" });
  });

  it("creates a new x-prefixed user when nothing matches", async () => {
    const store = new InMemoryCassieStore();

    const settings = await resolveXSessionSettings(store, {
      xUserId: "x_999",
      xUsername: "newuser",
      name: "New User",
      image: "https://example.com/avatar.png",
    });

    expect(settings.userId).toBe("x:x_999");
    expect(settings.privyUserId).toBeNull();
    expect(settings.x).toEqual({ userId: "x_999", username: "newuser" });
    expect(settings.profile).toEqual({
      name: "New User",
      handle: "newuser",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(settings.defaultTradeSizeUsd).toBe(50);
  });

  it("rejects a cookie session without an X user id", async () => {
    const store = new InMemoryCassieStore();
    await expect(
      resolveXSessionSettings(store, {
        xUserId: null,
        xUsername: "cassie",
        name: "Cassie",
        image: null,
      }),
    ).rejects.toThrow("X session is missing the X user id.");
  });
});

describe("authenticateRequest dual path", () => {
  it("resolves a better-auth cookie session", async () => {
    const store = new InMemoryCassieStore();
    const auth = fakeAuth({
      user: {
        id: "auth_user_1",
        name: "Cassie",
        image: null,
        xUserId: "x_123",
        xUsername: "cassie",
      },
    });

    const session = await authenticateRequest(cookieRequest(), { store, auth });

    expect(session.method).toBe("cookie");
    expect(session.userId).toBe("x:x_123");
    expect(session.settings?.x).toEqual({ userId: "x_123", username: "cassie" });
  });

  it("falls back to a Privy bearer token when no cookie session exists", async () => {
    const store = new InMemoryCassieStore();
    await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile,
    });
    const request = new Request("http://localhost/api/account", {
      headers: { Authorization: "Bearer privy-token" },
    });
    const privyGateway = {
      verifyAccessToken: vi.fn().mockResolvedValue({ user_id: "did:privy:user_1" }),
    };

    const session = await authenticateRequest(request, { store, privyGateway });

    expect(session.method).toBe("privy_bearer");
    expect(session.userId).toBe("did:privy:user_1");
    expect(session.privyUserId).toBe("did:privy:user_1");
    expect(session.settings?.privyWalletId).toBe("wallet_1");
    expect(privyGateway.verifyAccessToken).toHaveBeenCalledWith("privy-token");
  });

  it("rejects when neither cookie nor bearer token is present", async () => {
    const store = new InMemoryCassieStore();
    const request = new Request("http://localhost/api/account");
    const privyGateway = { verifyAccessToken: vi.fn() };

    await expect(
      authenticateRequest(request, { store, privyGateway }),
    ).rejects.toThrow("Missing Privy access token.");
  });
});
