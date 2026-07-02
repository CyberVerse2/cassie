CREATE TABLE IF NOT EXISTS "auth_users" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "x_user_id" text,
  "x_username" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);

CREATE INDEX IF NOT EXISTS "auth_users_x_user_id_idx"
  ON "auth_users" ("x_user_id");

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL,
  "token" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "auth_sessions_token_unique" UNIQUE("token"),
  CONSTRAINT "auth_sessions_user_id_auth_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx"
  ON "auth_sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp,
  "refresh_token_expires_at" timestamp,
  "scope" text,
  "password" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "auth_accounts_user_id_auth_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "auth_accounts_user_id_idx"
  ON "auth_accounts" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
