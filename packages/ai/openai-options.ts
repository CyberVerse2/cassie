import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";

type CostControlInput = {
  promptCacheKey: string;
  reasoningEffort?: OpenAILanguageModelResponsesOptions["reasoningEffort"];
  serviceTier?: OpenAILanguageModelResponsesOptions["serviceTier"];
  textVerbosity?: OpenAILanguageModelResponsesOptions["textVerbosity"];
};

export function openAiCostControlOptions(input: CostControlInput) {
  return {
    openai: {
      store: false,
      serviceTier: input.serviceTier ?? openAiServiceTier(),
      textVerbosity: input.textVerbosity ?? "low",
      reasoningEffort: input.reasoningEffort ?? "minimal",
      promptCacheKey: input.promptCacheKey,
    } satisfies OpenAILanguageModelResponsesOptions,
  };
}

function openAiServiceTier(): OpenAILanguageModelResponsesOptions["serviceTier"] {
  const value = process.env.CASSIE_OPENAI_SERVICE_TIER;
  return value === "auto" || value === "default" || value === "priority" ? value : "flex";
}
