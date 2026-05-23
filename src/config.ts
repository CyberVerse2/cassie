import { z } from "zod";
import { currentEnv, type EnvSource } from "../packages/core/config.ts";

export const RuntimeConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CASSIE_API_TOKEN: z.string().min(16),
  GEMINI_API_KEY: z.string().min(1),
  XAI_API_KEY: z.string().min(1),
});

export function assertRuntimeConfig(env: EnvSource = currentEnv()): void {
  const result = RuntimeConfigSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");
    throw new Error(`Cassie runtime config is incomplete: ${missing}`);
  }
}
