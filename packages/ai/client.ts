import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { Output, generateText } from "ai";
import { z } from "zod";
import type { TraceRecorder } from "../core/trace.ts";
import { formatErrorForLog } from "../core/helpers/index.ts";
import {
  config,
} from "../core/config.ts";
import { configureAiSdkWarningLogging } from "./helpers/index.ts";

configureAiSdkWarningLogging();

export const DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS = 8_192;
export const IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS = 32_768;
const DEFAULT_STRUCTURED_MAX_RETRIES = 2;

export type ModelTier = "cheap" | "expensive";
export type ModelProvider = "deepseek" | "openai";

export type ModelRoute = {
  tier: ModelTier;
  provider: ModelProvider;
  model: string;
};

export const IMPORTANT_OPENAI_REASONING_EFFORT = "medium";

export interface StructuredAiClient {
  generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
    tier?: ModelTier;
    onThinkingTrace?: (thinkingTrace: string | null) => void;
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
  constructor(message = "AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's important GPT judgment tools.") {
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
    : { tier, provider: "openai", model: expensiveModel };
}

export function providerOptionsForRoute(route: ModelRoute) {
  return route.provider === "openai"
    ? {
      openai: {
        reasoningEffort: IMPORTANT_OPENAI_REASONING_EFFORT,
        reasoningSummary: "auto",
      },
    }
    : undefined;
}

export function extractModelThinkingTrace(result: {
  reasoningText?: string;
  reasoning?: unknown[];
}): string | null {
  if (typeof result.reasoningText === "string" && result.reasoningText.trim().length > 0) {
    return result.reasoningText;
  }

  const reasoningText = (result.reasoning ?? [])
    .map((part) => {
      const record = part && typeof part === "object" ? part as Record<string, unknown> : {};
      return typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
  return reasoningText.length > 0 ? reasoningText : null;
}

export function withThinkingTraceCapture(
  ai: StructuredAiClient,
  onThinkingTrace: (thinkingTrace: string | null) => void,
): StructuredAiClient {
  return {
    generateObject: (input) => ai.generateObject({
      ...input,
      onThinkingTrace: (thinkingTrace) => {
        onThinkingTrace(thinkingTrace);
        input.onThinkingTrace?.(thinkingTrace);
      },
    }),
  };
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
    onThinkingTrace?: (thinkingTrace: string | null) => void;
  }): Promise<T> {
    const route = routeStructuredModel({
      name: input.name,
      tier: input.tier,
      cheapModel: this.cheapModelName,
      expensiveModel: this.expensiveModelName,
    });

    const deepSeekKey = config.ai.deepSeekApiKey;
    if (route.provider === "deepseek" && !deepSeekKey) {
      throw new MissingAiDependencyError("AI dependency unavailable. Set DEEPSEEK_API_KEY to run Cassie's cheap DeepSeek bookkeeping tools.");
    }
    const openAiKey = config.ai.openAiApiKey;
    if (route.provider === "openai" && !openAiKey) {
      throw new MissingImportantAiDependencyError("AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's important GPT judgment tools.");
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
      const openai = createOpenAI({
        apiKey: openAiKey,
      });
      const result = await generateText({
        model: route.provider === "openai"
          ? openai.chat(route.model)
          : deepseek.chat(route.model),
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        prompt: input.prompt,
        maxRetries: structuredMaxRetries(),
        maxOutputTokens: maxOutputTokensForTier(route.tier),
        providerOptions: providerOptionsForRoute(route),
      });

      finishTrace?.({
        output: result.output,
        usage: result.totalUsage,
      });
      input.onThinkingTrace?.(extractModelThinkingTrace(result));

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

function structuredMaxRetries(): number {
  return config.structuredAi.maxRetries;
}

function maxOutputTokensForTier(tier: ModelTier): number {
  return tier === "expensive"
    ? IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS
    : DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS;
}
