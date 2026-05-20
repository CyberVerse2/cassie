CREATE TABLE IF NOT EXISTS "runtime_state" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" text NOT NULL
);
