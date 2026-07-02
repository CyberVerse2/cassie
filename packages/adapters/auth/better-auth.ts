import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import {
  assertAuthEnv,
  config,
  type AuthEnv,
} from "../../core/config.ts";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "../../core/db/auth-schema.ts";
import { createCassieDb, type CassieDb } from "../../core/db/client.ts";

export type CassieAuth = ReturnType<typeof createAuth>;

export function createAuth(env: AuthEnv = config.auth, db: CassieDb = createCassieDb()) {
  const required = assertAuthEnv(env);
  const fallbackHost = required.allowedHosts.find((host) => !host.includes("*"));
  return betterAuth({
    secret: required.secret,
    // Static BETTER_AUTH_URL wins when set; otherwise the base URL is derived
    // per request from host / x-forwarded-host + x-forwarded-proto, validated
    // against the allowed hosts.
    baseURL: required.baseUrl ?? {
      allowedHosts: required.allowedHosts,
      protocol: "auto",
      ...(fallbackHost ? { fallback: `https://${fallbackHost}` } : {}),
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    socialProviders: {
      twitter: {
        clientId: required.twitterClientId,
        clientSecret: required.twitterClientSecret,
        mapProfileToUser: (profile) => ({
          xUserId: profile.data.id,
          xUsername: profile.data.username,
        }),
      },
    },
    user: {
      additionalFields: {
        xUserId: { type: "string", required: false, input: false },
        xUsername: { type: "string", required: false, input: false },
      },
    },
    // Dash reads BETTER_AUTH_API_KEY from the environment for ownership
    // verification and the hosted dashboard. nextCookies relays Set-Cookie
    // headers when auth APIs run inside Next.js server actions and must be
    // the last plugin.
    plugins: [dash(), nextCookies()],
  });
}

const sharedAuthKey = Symbol.for("cassie.better-auth");

type AuthGlobal = typeof globalThis & {
  [sharedAuthKey]?: CassieAuth;
};

export function sharedAuth(): CassieAuth {
  const globalScope = globalThis as AuthGlobal;
  globalScope[sharedAuthKey] ??= createAuth();
  return globalScope[sharedAuthKey];
}
