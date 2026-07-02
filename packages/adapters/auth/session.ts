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

export async function authenticateRequest(
  request: Request,
  deps: {
    store: CassieStore;
    auth?: CassieAuth;
    privyGateway?: Pick<PrivyWalletGateway, "verifyAccessToken">;
  },
): Promise<AuthenticatedSession> {
  const identity = await cookieSessionIdentity(request, deps.auth);
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
      return existing;
    }
    const updated: UserSettings = {
      ...existing,
      x: {
        userId: identity.xUserId,
        username: identity.xUsername ?? existing.x?.username ?? null,
      },
    };
    await store.upsertUserSettings(updated);
    return updated;
  }
  const handle = identity.xUsername ?? identity.xUserId;
  return store.syncXUser({
    xUserId: identity.xUserId,
    username: identity.xUsername,
    profile: {
      name: identity.name || handle,
      handle,
      avatarUrl: identity.image,
    },
  });
}

async function cookieSessionIdentity(
  request: Request,
  auth?: CassieAuth,
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
  };
  return {
    xUserId: user.xUserId ?? null,
    xUsername: user.xUsername ?? null,
    name: user.name,
    image: user.image ?? null,
  };
}
