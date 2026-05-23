import type { StructuredAiClient } from "../../ai/client.ts";
import {
  CritiqueSchema,
  type Critique,
  type Thesis,
} from "../../core/schemas/index.ts";
import { critiquePrompt } from "../../prompts/index.ts";

export async function critiqueThesis(input: {
  ai: StructuredAiClient;
  thesis: Thesis;
}): Promise<Critique> {
  return input.ai.generateObject({
    schema: CritiqueSchema,
    name: "cassie_critique",
    prompt: critiquePrompt(input),
  });
}
