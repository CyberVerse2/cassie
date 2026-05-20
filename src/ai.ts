import { openai } from "@ai-sdk/openai";
import { Output, generateText } from "ai";
import type { z } from "zod";

export interface StructuredAiClient {
  generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
  }): Promise<T>;
}

export class MissingAiDependencyError extends Error {
  constructor(message = "AI dependency unavailable. Set OPENAI_API_KEY to run Cassie's AI tools.") {
    super(message);
    this.name = "MissingAiDependencyError";
  }
}

export class OpenAiStructuredClient implements StructuredAiClient {
  private readonly modelName: string;

  constructor(modelName = process.env.CASSIE_MODEL ?? "gpt-5.5") {
    this.modelName = modelName;
  }

  async generateObject<T>(input: {
    schema: z.ZodType<T>;
    prompt: string;
    name: string;
  }): Promise<T> {
    if (!process.env.OPENAI_API_KEY) {
      throw new MissingAiDependencyError();
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
