import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { openai } from "@ai-sdk/openai";
import { Output, generateText } from "ai";
import type { z } from "zod";

export const DEFAULT_CHEAP_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_IMPORTANT_MODEL = "gpt-5.5";

export interface StructuredAiClient {
  generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
  }): Promise<T>;
}

export class MissingAiDependencyError extends Error {
  constructor(message = "AI dependency unavailable. Set OPENROUTER_API_KEY to run Cassie's cheap AI tools.") {
    super(message);
    this.name = "MissingAiDependencyError";
  }
}

export class MissingImportantAiDependencyError extends Error {
  constructor(message = "AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's important AI tools.") {
    super(message);
    this.name = "MissingImportantAiDependencyError";
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
  }): Promise<T> {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new MissingAiDependencyError();
    }

    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
      compatibility: "strict",
      extraBody: {
        provider: {
          allow_fallbacks: false,
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
      prompt: input.prompt,
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
    });

    return result.output;
  }
}
