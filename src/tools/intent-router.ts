import type { StructuredAiClient } from "../ai.ts";
import { IntentResultSchema, type IntentResult, type SourcePost } from "../schemas.ts";
import { intentRouterPrompt } from "../prompts.ts";

export async function routeIntent(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<IntentResult> {
  return input.ai.generateObject({
    schema: IntentResultSchema,
    name: "cassie_intent",
    prompt: intentRouterPrompt(input),
  });
}
