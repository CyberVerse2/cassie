import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CASSIE_API_TOKEN: z.string().min(16),
  OPENAI_API_KEY: z.string().min(1),
  XAI_API_KEY: z.string().min(1),
});

export function assertRuntimeConfig(env = process.env): void {
  const result = RuntimeConfigSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");
    throw new Error(`Cassie runtime config is incomplete: ${missing}`);
  }
}
