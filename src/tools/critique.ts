import type { StructuredAiClient } from "../ai.js";
import {
  CritiqueSchema,
  type Critique,
  type ResearchReport,
  type Thesis,
} from "../schemas.js";
import { critiquePrompt } from "../prompts.js";

export async function critiqueThesis(input: {
  ai: StructuredAiClient;
  thesis: Thesis;
  researchReport: ResearchReport;
}): Promise<Critique> {
  return input.ai.generateObject({
    schema: CritiqueSchema,
    name: "cassie_critique",
    prompt: critiquePrompt(input),
  });
}
