import type { StructuredAiClient } from "../ai.js";
import { IntentResultSchema, type IntentResult, type SourcePost } from "../schemas.js";
import { intentRouterPrompt } from "../prompts.js";

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
