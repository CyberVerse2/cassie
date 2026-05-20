import type { StructuredAiClient } from "../ai.js";
import {
  InverseThesisSchema,
  ThesisSchema,
  type InverseThesis,
  type SourcePost,
  type Thesis,
} from "../schemas.js";
import { inverseThesisPrompt, thesisPrompt } from "../prompts.js";

export async function extractThesis(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<Thesis> {
  return input.ai.generateObject({
    schema: ThesisSchema,
    name: "cassie_thesis",
    prompt: thesisPrompt(input),
  });
}

export async function extractInverseThesis(input: {
  ai: StructuredAiClient;
  thesis: Thesis;
}): Promise<InverseThesis> {
  return input.ai.generateObject({
    schema: InverseThesisSchema,
    name: "cassie_inverse_thesis",
    prompt: inverseThesisPrompt(input),
  });
}
