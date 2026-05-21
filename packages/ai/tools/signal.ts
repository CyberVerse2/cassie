import type { StructuredAiClient } from "../client.ts";
import {
  SignalInterpretationSchema,
  type SignalInterpretation,
  type SourcePost,
} from "../../core/schemas/index.ts";
import { signalInterpretationPrompt } from "../prompts/index.ts";

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
