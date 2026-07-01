import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { Output, generateText, type ModelMessage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { TraceRecorder } from "../core/trace.ts";
import { formatErrorForLog } from "../core/helpers/error-format.ts";
import { config } from "../core/config.ts";
import { configureAiSdkWarningLogging } from "./helpers/sdk-warnings.ts";

configureAiSdkWarningLogging();

export const DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS = 8_192;
export const IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS = 32_768;

export type ModelTier = "cheap" | "expensive";
export type ModelProvider = "deepseek" | "openai" | "xai";

export type ModelRoute = {
  tier: ModelTier;
  provider: ModelProvider;
  model: string;
};

export const IMPORTANT_OPENAI_REASONING_EFFORT = "medium";

export type StructuredToolConfig = {
  webSearch?: {
    externalWebAccess: true;
    searchContextSize: "low" | "medium" | "high";
  };
};

export type StructuredAiUsage = {
  provider: ModelProvider;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
};

export interface StructuredAiClient {
  generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    system?: string;
    messages?: ModelMessage[];
    name: string;
    tier?: ModelTier;
    providerOptions?: ProviderOptions;
    tools?: StructuredToolConfig;
    onThinkingTrace?: (thinkingTrace: string | null) => void;
    onUsage?: (usage: StructuredAiUsage) => void | Promise<void>;
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
  constructor(
    message = "AI dependency unavailable. Set DEEPSEEK_API_KEY to run Cassie's cheap AI tools.",
  ) {
    super(message);
    this.name = "MissingAiDependencyError";
  }
}

export class MissingImportantAiDependencyError extends MissingAiDependencyError {
  constructor(
    message = "AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's important GPT judgment tools.",
  ) {
    super(message);
    this.name = "MissingImportantAiDependencyError";
  }
}

const cheapStructuredSteps = new Set(["cassie_market_selection"]);
const xaiStructuredSteps = new Set(["cassie_context_discovery"]);

export function routeStructuredModel(input: {
  name: string;
  tier?: ModelTier;
  cheapModel?: string;
  expensiveModel?: string;
  xaiModel?: string;
}): ModelRoute {
  const cheapModel = input.cheapModel ?? config.ai.cheapModel;
  const expensiveModel = input.expensiveModel ?? config.ai.importantModel;
  const xaiModel = input.xaiModel ?? config.ai.grokXSearchModel;
  if (xaiStructuredSteps.has(input.name)) {
    return { tier: "expensive", provider: "xai", model: xaiModel };
  }

  const tier =
    input.tier ??
    (cheapStructuredSteps.has(input.name) ? "cheap" : "expensive");

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
  if (
    typeof result.reasoningText === "string" &&
    result.reasoningText.trim().length > 0
  ) {
    return result.reasoningText;
  }

  const reasoningText = (result.reasoning ?? [])
    .map((part) => {
      const record =
        part && typeof part === "object"
          ? (part as Record<string, unknown>)
          : {};
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
    generateObject: (input) =>
      ai.generateObject({
        ...input,
        onThinkingTrace: (thinkingTrace) => {
          onThinkingTrace(thinkingTrace);
          input.onThinkingTrace?.(thinkingTrace);
        },
      }),
  };
}

export function withUsageCapture(
  ai: StructuredAiClient,
  onUsage: (usage: StructuredAiUsage) => void | Promise<void>,
): StructuredAiClient {
  return {
    generateObject: (input) =>
      ai.generateObject({
        ...input,
        onUsage: async (usage) => {
          await onUsage(usage);
          await input.onUsage?.(usage);
        },
      }),
  };
}

type OpenAiProviderForStructuredCall = {
  (model: string): unknown;
  tools: {
    webSearch: (input: {
      externalWebAccess: true;
      searchContextSize: "low" | "medium" | "high";
    }) => unknown;
  };
};

type XaiProviderForStructuredCall = {
  tools: {
    webSearch: (input: { enableImageUnderstanding: true }) => unknown;
    xSearch: (input: {
      enableImageUnderstanding: true;
      enableVideoUnderstanding: true;
    }) => unknown;
  };
};

export function structuredToolsForCall(input: {
  route: ModelRoute;
  openai?: Pick<OpenAiProviderForStructuredCall, "tools">;
  xai?: XaiProviderForStructuredCall;
  tools?: StructuredToolConfig;
}): Record<string, unknown> | undefined {
  if (!input.tools?.webSearch) {
    return undefined;
  }

  if (input.route.provider === "openai" && input.openai) {
    return {
      web_search: input.openai.tools.webSearch(input.tools.webSearch),
    };
  }

  if (input.route.provider === "xai" && input.xai) {
    return {
      web_search: input.xai.tools.webSearch({
        enableImageUnderstanding: true,
      }),
      x_search: input.xai.tools.xSearch({
        enableImageUnderstanding: true,
        enableVideoUnderstanding: true,
      }),
    };
  }

  return undefined;
}

export function openAiModelForStructuredCall(input: {
  route: ModelRoute;
  openai: (model: string) => unknown;
}): unknown {
  return input.openai(input.route.model);
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
    system?: string;
    messages?: ModelMessage[];
    name: string;
    tier?: ModelTier;
    providerOptions?: ProviderOptions;
    tools?: StructuredToolConfig;
    onThinkingTrace?: (thinkingTrace: string | null) => void;
    onUsage?: (usage: StructuredAiUsage) => void | Promise<void>;
  }): Promise<T> {
    const route = routeStructuredModel({
      name: input.name,
      tier: input.tier,
      cheapModel: this.cheapModelName,
      expensiveModel: this.expensiveModelName,
      xaiModel: config.ai.grokXSearchModel,
    });

    const deepSeekKey = config.ai.deepSeekApiKey;
    if (route.provider === "deepseek" && !deepSeekKey) {
      throw new MissingAiDependencyError(
        "AI dependency unavailable. Set DEEPSEEK_API_KEY to run Cassie's cheap DeepSeek bookkeeping tools.",
      );
    }
    const openAiKey = config.ai.openAiApiKey;
    if (route.provider === "openai" && !openAiKey) {
      throw new MissingImportantAiDependencyError(
        "AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's important GPT judgment tools.",
      );
    }
    const xAiKey = config.ai.xAiApiKey;
    if (route.provider === "xai" && !xAiKey) {
      throw new MissingImportantAiDependencyError(
        "AI dependency unavailable. Set XAI_API_KEY to run Cassie's Grok context discovery.",
      );
    }

    const finishTrace = this.trace?.start({
      name: input.name,
      kind: "ai",
      model: route.model,
      thinkingTrace:
        route.tier === "cheap"
          ? "Requesting cheap structured extraction/classification and validating it against the expected schema."
          : "Requesting an expensive structured judgment and validating it against the expected schema.",
      input: {
        schemaName: input.name,
        promptChars: promptTextForTrace(input).length,
        modelTier: route.tier,
        provider: route.provider,
      },
    });

    try {
      let tools: Record<string, unknown> | undefined;
      let model: Parameters<typeof generateText>[0]["model"];

      if (route.provider === "openai") {
        const openai = createOpenAI({ apiKey: openAiKey });
        model = openAiModelForStructuredCall({ route, openai }) as Parameters<
          typeof generateText
        >[0]["model"];
        tools = structuredToolsForCall({
          route,
          openai,
          tools: input.tools,
        });
      } else if (route.provider === "xai") {
        const xai = createXai({ apiKey: xAiKey });
        model = xai.responses(route.model) as Parameters<
          typeof generateText
        >[0]["model"];
        tools = structuredToolsForCall({
          route,
          xai,
          tools: input.tools,
        });
      } else {
        model = createDeepSeek({ apiKey: deepSeekKey }).chat(route.model);
      }

      const result = await generateText({
        model,
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        ...promptParametersForStructuredCall(input),
        maxRetries: structuredMaxRetries(),
        maxOutputTokens: maxOutputTokensForTier(route.tier),
        providerOptions:
          input.providerOptions ?? providerOptionsForRoute(route),
        tools: tools as never,
      });

      const usage = structuredUsageRecord(route, result.totalUsage);
      finishTrace?.({
        output: result.output,
        usage: result.totalUsage,
      });
      await input.onUsage?.(usage);
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

export function promptParametersForStructuredCall(input: {
  prompt?: string;
  system?: string;
  messages?: ModelMessage[];
}): { prompt: string } | { system?: string; messages: ModelMessage[] } {
  if (input.messages) {
    return input.system
      ? { system: input.system, messages: input.messages }
      : { messages: input.messages };
  }
  if (!input.prompt) {
    throw new Error("Structured AI call requires either prompt or messages.");
  }
  return { prompt: input.prompt };
}

function structuredUsageRecord(
  route: ModelRoute,
  usage: unknown,
): StructuredAiUsage {
  const record = objectRecord(usage);
  const outputDetails = objectRecord(record.outputTokenDetails);
  const inputDetails = objectRecord(record.inputTokenDetails);
  return {
    provider: route.provider,
    model: route.model,
    inputTokens: numberOrNull(record.inputTokens),
    outputTokens: numberOrNull(record.outputTokens),
    reasoningTokens: numberOrNull(outputDetails.reasoningTokens),
    cachedTokens: numberOrNull(inputDetails.cacheReadTokens),
    totalTokens: numberOrNull(record.totalTokens),
  };
}

function promptTextForTrace(input: {
  prompt?: string;
  system?: string;
  messages?: ModelMessage[];
}): string {
  if (input.prompt) return input.prompt;
  return [
    input.system ?? "",
    ...(input.messages ?? []).map((message) => JSON.stringify(message)),
  ].join("\n");
}

function structuredMaxRetries(): number {
  return config.structuredAi.maxRetries;
}

function maxOutputTokensForTier(tier: ModelTier): number {
  return tier === "expensive"
    ? IMPORTANT_STRUCTURED_MAX_OUTPUT_TOKENS
    : DIRECT_STRUCTURED_MAX_OUTPUT_TOKENS;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
