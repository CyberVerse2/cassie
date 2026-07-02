import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./packages/core/db/schema.ts",
    "./packages/core/db/auth-schema.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
