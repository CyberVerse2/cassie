import { createDeepSeek } from "@ai-sdk/deepseek";
import { Output, generateText } from "ai";
import { z } from "zod";
import type { TraceRecorder } from "../core/trace.ts";
import { formatErrorForLog } from "../core/error-format.ts";
import {
  config,
} from "../core/config.ts";
import { configureAiSdkWarningLogging } from "./sdk-warnings.ts";

configureAiSdkWarningLogging();

export const DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS = 8_192;
export const IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS = 32_768;
export const DEFAULT_CHEAP_MODEL = "deepseek-v4-flash";
export const DEFAULT_IMPORTANT_MODEL = "deepseek-v4-pro";
export const DEFAULT_EXPENSIVE_MODEL = DEFAULT_IMPORTANT_MODEL;
const DEFAULT_STRUCTURED_MAX_RETRIES = 2;

export type ModelTier = "cheap" | "expensive";
export type ModelProvider = "deepseek";

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
  constructor(message = "AI dependency unavailable. Set DEEPSEEK_API_KEY to run Cassie's important DeepSeek judgment tools.") {
    super(message);
    this.name = "MissingImportantAiDependencyError";
  }
}

const cheapStructuredSteps = new Set([
  "cassie_market_selection",
]);

export function routeStructuredModel(input: {
  name: string;
  tier?: ModelTier;
  cheapModel?: string;
  expensiveModel?: string;
}): ModelRoute {
  const cheapModel = input.cheapModel ?? config.ai.cheapModel;
  const expensiveModel = input.expensiveModel ?? config.ai.importantModel;
  const tier = input.tier ?? (cheapStructuredSteps.has(input.name) ? "cheap" : "expensive");

  return tier === "cheap"
    ? { tier, provider: "deepseek", model: cheapModel }
    : { tier, provider: "deepseek", model: expensiveModel };
}

export class CassieStructuredClient implements StructuredAiClient {
  private readonly expensiveModelName: string;
  private readonly cheapModelName: string;

  constructor(
    modelName = config.ai.importantModel,
    private readonly trace?: TraceRecorder,
    cheapModelName = config.ai.cheapModel,
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

    const deepSeekKey = config.ai.deepSeekApiKey;
    if (route.provider === "deepseek" && !deepSeekKey) {
      if (route.tier === "expensive") {
        throw new MissingImportantAiDependencyError();
      }
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
      const deepseek = createDeepSeek({
        apiKey: deepSeekKey,
      });
      const result = route.tier === "expensive"
        ? await generateDeepSeekJsonText({
          model: deepseek.chat(route.model),
          schema: input.schema,
          name: input.name,
          prompt: input.prompt,
          maxOutputTokens: IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS,
        })
        : await generateText({
          model: deepseek.chat(route.model),
          output: Output.object({
            schema: input.schema,
            name: input.name,
          }),
          prompt: input.prompt,
          maxRetries: structuredMaxRetries(),
          maxOutputTokens: DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS,
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

  constructor(modelName = config.ai.cheapModel) {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    const apiKey = config.ai.deepSeekApiKey;
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

export class DirectDeepSeekImportantStructuredClient implements StructuredAiClient {
  private readonly modelName: string;

  constructor(modelName = config.ai.importantModel) {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
  }): Promise<T> {
    const apiKey = config.ai.deepSeekApiKey;
    if (!apiKey) {
      throw new MissingImportantAiDependencyError();
    }

    const deepseek = createDeepSeek({
      apiKey,
    });

    try {
      const result = await generateDeepSeekJsonText({
        model: deepseek.chat(this.modelName),
        schema: input.schema,
        name: input.name,
        prompt: input.prompt,
        maxOutputTokens: IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS,
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

function structuredMaxRetries(): number {
  return config.structuredAi.maxRetries;
}

async function generateDeepSeekJsonText<T>(input: {
  model: Parameters<typeof generateText>[0]["model"];
  schema: z.ZodType<T>;
  name: string;
  prompt: string;
  maxOutputTokens: number;
}): Promise<{ output: T; totalUsage: unknown }> {
  const result = await generateText({
    model: input.model,
    prompt: buildDeepSeekJsonPrompt(input),
    maxRetries: structuredMaxRetries(),
    maxOutputTokens: input.maxOutputTokens,
  });
  return {
    output: input.schema.parse(parseJsonFromText(result.text)),
    totalUsage: result.totalUsage,
  };
}

function buildDeepSeekJsonPrompt<T>(input: {
  schema: z.ZodType<T>;
  name: string;
  prompt: string;
}) {
  return `${input.prompt}

Return the final answer as raw JSON only, with no Markdown fence and no prose outside the JSON.
The JSON must validate against this schema for ${input.name}:
${renderJsonSchemaHint(input.schema)}`;
}

function renderJsonSchemaHint<T>(schema: z.ZodType<T>): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
    }), null, 2);
  } catch {
    return "Use the field names, enum values, nullability, and numeric ranges described in the task prompt. The response will be validated before it is accepted.";
  }
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("DeepSeek returned empty text for a required JSON response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = firstJsonStart(trimmed);
    const end = lastJsonEnd(trimmed);
    if (start < 0 || end <= start) {
      throw new Error(`DeepSeek did not return parseable JSON: ${trimmed.slice(0, 500)}`);
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function firstJsonStart(value: string): number {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;
  return Math.min(objectStart, arrayStart);
}

function lastJsonEnd(value: string): number {
  return Math.max(value.lastIndexOf("}"), value.lastIndexOf("]"));
}
