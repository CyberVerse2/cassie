import type { StructuredAiClient } from "../ai.ts";
import {
  InverseThesisSchema,
  ThesisSchema,
  type InverseThesis,
  type SignalInterpretation,
  type SourcePost,
  type Thesis,
} from "../schemas.ts";
import { inverseThesisPrompt, thesisPrompt } from "../prompts.ts";

export async function extractThesis(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
  signal: SignalInterpretation;
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
