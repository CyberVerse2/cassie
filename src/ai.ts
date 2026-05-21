import { openai } from "@ai-sdk/openai";
import { Output, generateText } from "ai";
import type { z } from "zod";
import type { TraceRecorder } from "./trace.ts";

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

  constructor(
    modelName = process.env.CASSIE_MODEL ?? "gpt-5.5",
    private readonly trace?: TraceRecorder,
  ) {
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

    const finishTrace = this.trace?.start({
      name: input.name,
      kind: "ai",
      model: this.modelName,
      thinkingTrace: "Requesting a structured AI judgment and validating it against the expected schema.",
      input: {
        schemaName: input.name,
        promptChars: input.prompt.length,
      },
    });

    try {
      const result = await generateText({
        model: openai(this.modelName),
        output: Output.object({
          schema: input.schema,
          name: input.name,
        }),
        prompt: input.prompt,
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
