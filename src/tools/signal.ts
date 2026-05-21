import type { StructuredAiClient } from "../ai.ts";
import {
  SignalInterpretationSchema,
  type SignalInterpretation,
  type SourcePost,
} from "../schemas.ts";
import { signalInterpretationPrompt } from "../prompts.ts";

export async function interpretSignal(input: {
  ai: StructuredAiClient;
  sourcePost: SourcePost;
  userCommand: string;
}): Promise<SignalInterpretation> {
  return input.ai.generateObject({
    schema: SignalInterpretationSchema,
    name: "cassie_signal",
    prompt: signalInterpretationPrompt(input),
  });
}
