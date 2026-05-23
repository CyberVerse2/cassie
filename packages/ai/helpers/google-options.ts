import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

export type GoogleThinkingLevel = "minimal" | "low" | "medium" | "high";

export function googleThinkingOptions(thinkingLevel: GoogleThinkingLevel = "low") {
  return {
    google: {
      thinkingConfig: {
        thinkingLevel,
        includeThoughts: false,
      },
    } satisfies GoogleLanguageModelOptions,
  };
}
