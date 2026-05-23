import type { StructuredAiClient } from "../../ai/client.ts";
import { IntentResultSchema, type IntentResult, type SourcePost } from "../../core/schemas/index.ts";
import { intentRouterPrompt } from "../../prompts/index.ts";

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
