import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
  return betterAuth({
    secret: required.secret,
    baseURL: required.baseUrl,
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
    // verification and the hosted dashboard.
    plugins: [dash()],
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
