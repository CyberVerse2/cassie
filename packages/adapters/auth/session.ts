import { and, eq } from "drizzle-orm";
import { authAccounts, authUsers } from "../../core/db/auth-schema.ts";
import { createCassieDb } from "../../core/db/client.ts";
import { config as runtimeConfig } from "../../core/config.ts";
import { MissingConnectorConfigError } from "../../core/helpers/connector-errors.ts";
import type { CassieStore } from "../../core/db/store.ts";
import type { UserSettings } from "../../core/schemas/index.ts";
import {
  authenticatePrivyRequest,
  type PrivyWalletGateway,
} from "../privy/index.ts";
import { sharedAuth, type CassieAuth } from "./better-auth.ts";

export type AuthenticatedSession = {
  method: "cookie" | "privy_bearer";
  userId: string;
  privyUserId: string | null;
  settings: UserSettings | null;
};

export type XSessionIdentity = {
  xUserId: string | null;
  xUsername: string | null;
  name: string;
  image: string | null;
};

export type XAccountStore = {
  twitterAccountId(authUserId: string): Promise<string | null>;
  persistXIdentity(
    authUserId: string,
    xUserId: string,
    xUsername: string | null,
  ): Promise<void>;
};

const defaultXAccountStore: XAccountStore = {
  async twitterAccountId(authUserId) {
    const db = createCassieDb();
    const rows = await db
      .select()
      .from(authAccounts)
      .where(and(
        eq(authAccounts.userId, authUserId),
        eq(authAccounts.providerId, "twitter"),
      ))
      .limit(1);
    return rows[0]?.accountId ?? null;
  },
  async persistXIdentity(authUserId, xUserId, xUsername) {
    const db = createCassieDb();
    await db
      .update(authUsers)
      .set({ xUserId, xUsername })
      .where(eq(authUsers.id, authUserId));
  },
};

export async function authenticateRequest(
  request: Request,
  deps: {
    store: CassieStore;
    auth?: CassieAuth;
    accounts?: XAccountStore;
    privyGateway?: Pick<PrivyWalletGateway, "verifyAccessToken">;
  },
): Promise<AuthenticatedSession> {
  const identity = await cookieSessionIdentity(request, deps.auth, deps.accounts);
  if (identity) {
    const settings = await resolveXSessionSettings(deps.store, identity);
    return {
      method: "cookie",
      userId: settings.userId,
      privyUserId: settings.privyUserId,
      settings,
    };
  }
  const claims = await authenticatePrivyRequest(request, deps.privyGateway);
  const settings =
    (await deps.store.getUserSettingsByPrivyUserId(claims.user_id)) ?? null;
  return {
    method: "privy_bearer",
    userId: settings?.userId ?? claims.user_id,
    privyUserId: claims.user_id,
    settings,
  };
}

export async function resolveXSessionSettings(
  store: CassieStore,
  identity: XSessionIdentity,
): Promise<UserSettings> {
  if (!identity.xUserId) {
    throw new Error("X session is missing the X user id.");
  }
  const existing = await store.getUserSettingsByXIdentity({
    userId: identity.xUserId,
    username: identity.xUsername,
  });
  if (existing) {
    if (existing.x?.userId === identity.xUserId) {
      return healMissingXUsername(store, existing);
    }
    const updated: UserSettings = {
      ...existing,
      x: {
        userId: identity.xUserId,
        username: identity.xUsername ?? existing.x?.username ?? null,
      },
    };
    await store.upsertUserSettings(updated);
    return healMissingXUsername(store, updated);
  }
  const handle = identity.xUsername ?? identity.xUserId;
  const created = await store.syncXUser({
    xUserId: identity.xUserId,
    username: identity.xUsername,
    profile: {
      name: identity.name || handle,
      handle,
      avatarUrl: identity.image,
    },
  });
  return healMissingXUsername(store, created);
}

// better-auth sometimes loses the X username at signup (it strips input:false
// fields, and the email fallback only works when X returns no real email),
// leaving the numeric X user id as the persisted handle. Recover the real
// username from the X API once and repair the stored profile.
const usernameHealAttempts = new Set<string>();

async function healMissingXUsername(
  store: CassieStore,
  settings: UserSettings,
): Promise<UserSettings> {
  const xUserId = settings.x?.userId;
  const numericHandle = /^\d+$/.test(settings.profile.handle);
  if (!xUserId || (settings.x?.username && !numericHandle)) return settings;
  if (usernameHealAttempts.has(settings.userId)) return settings;
  usernameHealAttempts.add(settings.userId);
  const bearerToken = runtimeConfig.x.bearerToken;
  if (!bearerToken) return settings;
  try {
    const response = await fetch(
      `https://api.x.com/2/users/${encodeURIComponent(xUserId)}`,
      { headers: { Authorization: `Bearer ${bearerToken}` } },
    );
    if (!response.ok) return settings;
    const payload = (await response.json()) as {
      data?: { username?: string; name?: string };
    };
    const username = payload.data?.username;
    if (!username) return settings;
    const healed: UserSettings = {
      ...settings,
      x: { userId: xUserId, username },
      profile: {
        ...settings.profile,
        handle: username,
        name: /^\d+$/.test(settings.profile.name)
          ? (payload.data?.name ?? username)
          : settings.profile.name,
      },
    };
    await store.upsertUserSettings(healed);
    return healed;
  } catch {
    return settings;
  }
}

async function cookieSessionIdentity(
  request: Request,
  auth?: CassieAuth,
  accounts: XAccountStore = defaultXAccountStore,
): Promise<XSessionIdentity | null> {
  if (!request.headers.get("cookie")) {
    return null;
  }
  let resolvedAuth: CassieAuth;
  try {
    resolvedAuth = auth ?? sharedAuth();
  } catch (error) {
    // better-auth not configured in this deployment; fall through to Privy.
    if (error instanceof MissingConnectorConfigError) return null;
    throw error;
  }
  const session = await resolvedAuth.api.getSession({
    headers: request.headers,
  });
  if (!session) {
    return null;
  }
  const user = session.user as typeof session.user & {
    xUserId?: string | null;
    xUsername?: string | null;
    email?: string | null;
  };
  let xUserId = user.xUserId ?? null;
  let xUsername = user.xUsername ?? null;
  if (!xUserId) {
    // better-auth strips input:false additional fields at signup, so the
    // X user id may be missing on the user row. The linked twitter account
    // row always carries it; recover from there and self-heal the user row.
    xUserId = await accounts.twitterAccountId(session.user.id);
    // The twitter provider stores the X username as the email fallback when
    // the app cannot read the real email.
    if (!xUsername && user.email && !user.email.includes("@")) {
      xUsername = user.email;
    }
    if (xUserId) {
      await accounts
        .persistXIdentity(session.user.id, xUserId, xUsername)
        .catch(() => undefined);
    }
  }
  return {
    xUserId,
    xUsername,
    name: user.name,
    image: user.image ?? null,
  };
}
