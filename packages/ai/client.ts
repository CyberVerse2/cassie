import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Output, generateText } from "ai";
import type { z } from "zod";
import type { TraceRecorder } from "../core/trace.ts";
import { formatErrorForLog } from "../core/error-format.ts";
import {
  cassieCheapModel,
  cassieImportantModel,
  deepSeekApiKey,
  googleApiKey,
  numberEnv,
} from "../core/env.ts";
import { googleThinkingOptions } from "./google-options.ts";
import { configureAiSdkWarningLogging } from "./sdk-warnings.ts";

configureAiSdkWarningLogging();

export const DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_CHEAP_MODEL = "deepseek-v4-flash";
export const DEFAULT_IMPORTANT_MODEL = "gemini-3.5-flash";
export const DEFAULT_EXPENSIVE_MODEL = DEFAULT_IMPORTANT_MODEL;
const DEFAULT_STRUCTURED_MAX_RETRIES = 2;

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

export class StructuredAiCallError extends Error {
  readonly cause: unknown;

  constructor(input: {
    name: string;
    provider: ModelProvider;
    model: string;
    cause: unknown;
  }) {
    super(
      `Structured AI call ${input.name} failed on ${input.provider}/${input.model}: ${formatErrorForLog(input.cause)}`,
    );
    this.name = "StructuredAiCallError";
    this.cause = input.cause;
  }
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
  const cheapModel = input.cheapModel ?? cassieCheapModel(DEFAULT_CHEAP_MODEL);
  const expensiveModel = input.expensiveModel ?? cassieImportantModel(DEFAULT_EXPENSIVE_MODEL);
  const tier = input.tier ?? (cheapStructuredSteps.has(input.name) ? "cheap" : "expensive");

  return tier === "cheap"
    ? { tier, provider: "deepseek", model: cheapModel }
    : { tier, provider: "google", model: expensiveModel };
}

export class CassieStructuredClient implements StructuredAiClient {
  private readonly expensiveModelName: string;
  private readonly cheapModelName: string;

  constructor(
    modelName = cassieImportantModel(DEFAULT_EXPENSIVE_MODEL),
    private readonly trace?: TraceRecorder,
    cheapModelName = cassieCheapModel(DEFAULT_CHEAP_MODEL),
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

    const googleKey = googleApiKey();
    const deepSeekKey = deepSeekApiKey();
    if (route.provider === "google" && !googleKey) {
      throw new MissingImportantAiDependencyError("AI dependency unavailable. Set GEMINI_API_KEY to run Cassie's expensive judgment tools.");
    }
    if (route.provider === "deepseek" && !deepSeekKey) {
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
          apiKey: deepSeekKey,
        })
        : null;
      const google = route.provider === "google"
        ? createGoogleGenerativeAI({
          apiKey: googleKey,
        })
        : null;
      const result = await generateText({
        model: route.provider === "deepseek" ? deepseek!.chat(route.model) : google!(route.model),
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        prompt: input.prompt,
        providerOptions: route.provider === "google" ? googleThinkingOptions("medium") : undefined,
        maxRetries: structuredMaxRetries(),
        ...(route.provider === "deepseek" ? { maxOutputTokens: DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS } : {}),
      });

      finishTrace?.({
        output: result.output,
        usage: result.totalUsage,
      });

      return result.output;
    } catch (error) {
      const wrapped = new StructuredAiCallError({
        name: input.name,
        provider: route.provider,
        model: route.model,
        cause: error,
      });
      finishTrace?.({ error: wrapped });
      throw wrapped;
    }
  }
}

export class DirectDeepSeekStructuredClient implements StructuredAiClient {
  private readonly modelName: string;

  constructor(modelName = cassieCheapModel(DEFAULT_CHEAP_MODEL)) {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    const apiKey = deepSeekApiKey();
    if (!apiKey) {
      throw new MissingAiDependencyError();
    }

    const deepseek = createDeepSeek({
      apiKey,
    });

    try {
      const result = await generateText({
        model: deepseek.chat(this.modelName),
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        prompt: input.prompt,
        maxRetries: structuredMaxRetries(),
        maxOutputTokens: DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS,
      });

      return result.output;
    } catch (error) {
      throw new StructuredAiCallError({
        name: input.name,
        provider: "deepseek",
        model: this.modelName,
        cause: error,
      });
    }
  }
}

export class GoogleImportantStructuredClient implements StructuredAiClient {
  private readonly modelName: string;

  constructor(modelName = cassieImportantModel(DEFAULT_IMPORTANT_MODEL)) {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    const apiKey = googleApiKey();
    if (!apiKey) {
      throw new MissingImportantAiDependencyError();
    }

    const google = createGoogleGenerativeAI({
      apiKey,
    });

    try {
      const result = await generateText({
        model: google(this.modelName),
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        prompt: input.prompt,
        providerOptions: googleThinkingOptions("medium"),
        maxRetries: structuredMaxRetries(),
      });

      return result.output;
    } catch (error) {
      throw new StructuredAiCallError({
        name: input.name,
        provider: "google",
        model: this.modelName,
        cause: error,
      });
    }
  }
}

function structuredMaxRetries(): number {
  return numberEnv("CASSIE_STRUCTURED_MAX_RETRIES", DEFAULT_STRUCTURED_MAX_RETRIES, undefined, {
    integer: true,
    min: 1,
  });
}
