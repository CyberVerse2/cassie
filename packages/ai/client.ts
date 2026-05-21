import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { openai } from "@ai-sdk/openai";
import { Output, generateText } from "ai";
import type { z } from "zod";
import type { TraceRecorder } from "../core/trace.ts";
import { openAiCostControlOptions } from "./openai-options.ts";
import { openRouterCacheablePrompt } from "./openrouter-options.ts";

export const DEFAULT_CHEAP_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_IMPORTANT_MODEL = "gpt-5.5";
export const DEFAULT_EXPENSIVE_MODEL = DEFAULT_IMPORTANT_MODEL;

export type ModelTier = "cheap" | "expensive";
export type ModelProvider = "openai" | "openrouter";

export type ModelRoute = {
  tier: ModelTier;
  provider: ModelProvider;
  model: string;
};

export interface StructuredAiClient {
  generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T>;
}

export class MissingAiDependencyError extends Error {
  constructor(message = "AI dependency unavailable. Set OPENROUTER_API_KEY to run Cassie's cheap AI tools.") {
    super(message);
    this.name = "MissingAiDependencyError";
  }
}

export class MissingImportantAiDependencyError extends MissingAiDependencyError {
  constructor(message = "AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's important AI tools.") {
    super(message);
    this.name = "MissingImportantAiDependencyError";
  }
}

const cheapStructuredSteps = new Set([
  "cassie_intent",
  "cassie_signal",
  "cassie_evidence_ledger",
]);

export function routeStructuredModel(input: {
  name: string;
  tier?: ModelTier;
  cheapModel?: string;
  expensiveModel?: string;
}): ModelRoute {
  const cheapModel = input.cheapModel ?? process.env.CASSIE_CHEAP_MODEL ?? process.env.OPENROUTER_CHEAP_MODEL ??
    DEFAULT_CHEAP_MODEL;
  const expensiveModel = input.expensiveModel ??
    process.env.CASSIE_IMPORTANT_MODEL ??
    process.env.CASSIE_EXPENSIVE_MODEL ??
    process.env.CASSIE_MODEL ??
    DEFAULT_EXPENSIVE_MODEL;
  const tier = input.tier ?? (cheapStructuredSteps.has(input.name) ? "cheap" : "expensive");

  return tier === "cheap"
    ? { tier, provider: "openrouter", model: cheapModel }
    : { tier, provider: "openai", model: expensiveModel };
}

export class OpenAiStructuredClient implements StructuredAiClient {
  private readonly expensiveModelName: string;
  private readonly cheapModelName: string;

  constructor(
    modelName = process.env.CASSIE_IMPORTANT_MODEL ??
      process.env.CASSIE_EXPENSIVE_MODEL ??
      process.env.CASSIE_MODEL ??
      DEFAULT_EXPENSIVE_MODEL,
    private readonly trace?: TraceRecorder,
    cheapModelName = process.env.CASSIE_CHEAP_MODEL ?? process.env.OPENROUTER_CHEAP_MODEL ?? DEFAULT_CHEAP_MODEL,
  ) {
    this.expensiveModelName = modelName;
    this.cheapModelName = cheapModelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    const route = routeStructuredModel({
      name: input.name,
      tier: input.tier,
      cheapModel: this.cheapModelName,
      expensiveModel: this.expensiveModelName,
    });

    if (route.provider === "openai" && !process.env.OPENAI_API_KEY) {
      throw new MissingImportantAiDependencyError("AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's expensive judgment tools.");
    }
    if (route.provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
      throw new MissingAiDependencyError("AI dependency unavailable. Set OPENROUTER_API_KEY to run Cassie's cheap DeepSeek bookkeeping tools.");
    }

    const finishTrace = this.trace?.start({
      name: input.name,
      kind: "ai",
      model: route.model,
      thinkingTrace: route.tier === "cheap"
        ? "Requesting cheap structured extraction/classification and validating it against the expected schema."
        : "Requesting an expensive structured judgment and validating it against the expected schema.",
      input: {
        schemaName: input.name,
        promptChars: input.prompt.length,
        modelTier: route.tier,
        provider: route.provider,
      },
    });

    try {
      const openrouter = route.provider === "openrouter"
        ? createOpenRouter({
          apiKey: process.env.OPENROUTER_API_KEY,
          compatibility: "strict",
          extraBody: {
            provider: {
              allow_fallbacks: true,
              require_parameters: true,
            },
          },
        })
        : null;
      const result = await generateText({
        model: route.provider === "openrouter" ? openrouter!(route.model) : openai(route.model),
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        ...(route.provider === "openrouter"
          ? { messages: openRouterCacheablePrompt(input.prompt) }
          : { prompt: input.prompt }),
        providerOptions: route.provider === "openai"
          ? openAiCostControlOptions({ promptCacheKey: input.name })
          : undefined,
      });

      finishTrace?.({
        output: result.output,
        usage: result.totalUsage,
      });

      return result.output;
    } catch (error) {
      finishTrace?.({ error });
      throw error;
    }
  }
}

export class OpenRouterStructuredClient implements StructuredAiClient {
  private readonly modelName: string;

  constructor(modelName = process.env.CASSIE_CHEAP_MODEL ?? DEFAULT_CHEAP_MODEL) {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new MissingAiDependencyError();
    }

    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
      compatibility: "strict",
      extraBody: {
        provider: {
          allow_fallbacks: true,
          require_parameters: true,
        },
      },
    });

    const result = await generateText({
      model: openrouter(this.modelName),
      output: Output.object({
        schema: input.schema,
        name: input.name,
      }),
      messages: openRouterCacheablePrompt(input.prompt),
    });

    return result.output;
  }
}

export class OpenAiImportantStructuredClient implements StructuredAiClient {
  private readonly modelName: string;

  constructor(modelName = process.env.CASSIE_IMPORTANT_MODEL ?? DEFAULT_IMPORTANT_MODEL) {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    if (!process.env.OPENAI_API_KEY) {
      throw new MissingImportantAiDependencyError();
    }

    const result = await generateText({
      model: openai(this.modelName),
      output: Output.object({
        schema: input.schema,
        name: input.name,
      }),
      prompt: input.prompt,
      providerOptions: openAiCostControlOptions({ promptCacheKey: input.name }),
    });

    return result.output;
  }
}
