import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Output, generateText } from "ai";
import type { z } from "zod";
import type { TraceRecorder } from "../core/trace.ts";
import { configureAiSdkWarningLogging } from "./sdk-warnings.ts";

configureAiSdkWarningLogging();

export const DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_CHEAP_MODEL = "deepseek-v4-flash";
export const DEFAULT_IMPORTANT_MODEL = "gemini-3.5-flash";
export const DEFAULT_EXPENSIVE_MODEL = DEFAULT_IMPORTANT_MODEL;

export type ModelTier = "cheap" | "expensive";
export type ModelProvider = "google" | "deepseek";

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
  constructor(message = "AI dependency unavailable. Set DEEPSEEK_API_KEY to run Cassie's cheap AI tools.") {
    super(message);
    this.name = "MissingAiDependencyError";
  }
}

export class MissingImportantAiDependencyError extends MissingAiDependencyError {
  constructor(message = "AI dependency unavailable. Set GEMINI_API_KEY to run Cassie's important AI tools.") {
    super(message);
    this.name = "MissingImportantAiDependencyError";
  }
}

const cheapStructuredSteps = new Set([
  "cassie_intent",
  "cassie_signal",
]);

export function routeStructuredModel(input: {
  name: string;
  tier?: ModelTier;
  cheapModel?: string;
  expensiveModel?: string;
}): ModelRoute {
  const cheapModel = input.cheapModel ?? process.env.CASSIE_CHEAP_MODEL ?? process.env.DEEPSEEK_MODEL ??
    DEFAULT_CHEAP_MODEL;
  const expensiveModel = input.expensiveModel ??
    process.env.CASSIE_IMPORTANT_MODEL ??
    process.env.CASSIE_EXPENSIVE_MODEL ??
    process.env.CASSIE_MODEL ??
    DEFAULT_EXPENSIVE_MODEL;
  const tier = input.tier ?? (cheapStructuredSteps.has(input.name) ? "cheap" : "expensive");

  return tier === "cheap"
    ? { tier, provider: "deepseek", model: cheapModel }
    : { tier, provider: "google", model: expensiveModel };
}

export class CassieStructuredClient implements StructuredAiClient {
  private readonly expensiveModelName: string;
  private readonly cheapModelName: string;

  constructor(
    modelName = process.env.CASSIE_IMPORTANT_MODEL ??
      process.env.CASSIE_EXPENSIVE_MODEL ??
      process.env.CASSIE_MODEL ??
      DEFAULT_EXPENSIVE_MODEL,
    private readonly trace?: TraceRecorder,
    cheapModelName = process.env.CASSIE_CHEAP_MODEL ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_CHEAP_MODEL,
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

    if (route.provider === "google" && !googleApiKey()) {
      throw new MissingImportantAiDependencyError("AI dependency unavailable. Set GEMINI_API_KEY to run Cassie's expensive judgment tools.");
    }
    if (route.provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
      throw new MissingAiDependencyError("AI dependency unavailable. Set DEEPSEEK_API_KEY to run Cassie's cheap DeepSeek bookkeeping tools.");
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
      const deepseek = route.provider === "deepseek"
        ? createDeepSeek({
          apiKey: process.env.DEEPSEEK_API_KEY,
        })
        : null;
      const google = route.provider === "google"
        ? createGoogleGenerativeAI({
          apiKey: googleApiKey(),
        })
        : null;
      const result = await generateText({
        model: route.provider === "deepseek" ? deepseek!.chat(route.model) : google!(route.model),
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        prompt: input.prompt,
        ...(route.provider === "deepseek" ? { maxOutputTokens: DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS } : {}),
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

export class DirectDeepSeekStructuredClient implements StructuredAiClient {
  private readonly modelName: string;

  constructor(modelName = process.env.CASSIE_CHEAP_MODEL ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_CHEAP_MODEL) {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new MissingAiDependencyError();
    }

    const deepseek = createDeepSeek({
      apiKey: process.env.DEEPSEEK_API_KEY,
    });

    const result = await generateText({
      model: deepseek.chat(this.modelName),
      output: Output.object({
        schema: input.schema,
        name: input.name,
      }),
      prompt: input.prompt,
      maxOutputTokens: DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS,
    });

    return result.output;
  }
}

export class GoogleImportantStructuredClient implements StructuredAiClient {
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
    if (!googleApiKey()) {
      throw new MissingImportantAiDependencyError();
    }

    const google = createGoogleGenerativeAI({
      apiKey: googleApiKey(),
    });

    const result = await generateText({
      model: google(this.modelName),
      output: Output.object({
        schema: input.schema,
        name: input.name,
      }),
      prompt: input.prompt,
    });

    return result.output;
  }
}

function googleApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}
