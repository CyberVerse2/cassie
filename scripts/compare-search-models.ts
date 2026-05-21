import "dotenv/config";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Output, generateText } from "ai";
import { z } from "zod";

const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_GEMINI_MODEL = "google/gemini-2.5-flash:online";

const SearchComparisonSchema = z.object({
  directAnswer: z.string(),
  visibleThinkingSummary: z.string(),
  keyFindings: z.array(z.string()),
  sourceQualityNotes: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
});

type ModelRunResult = {
  ok: boolean;
  provider: "openai" | "openrouter";
  model: string;
  elapsedMs: number;
  output: z.infer<typeof SearchComparisonSchema> | null;
  text: string | null;
  reasoning: unknown;
  sources: unknown[];
  toolCalls: unknown[];
  toolResults: unknown[];
  usage: unknown;
  error: string | null;
};

const query = flag("query") ??
  "Search and critique the claim that Exa raised $250M at a $2.2B valuation led by a16z. What is verified, what matters, and what remains unresolved?";
const openAiModel = flag("openai-model") ?? process.env.OPENAI_WEB_SEARCH_MODEL ?? DEFAULT_OPENAI_MODEL;
const geminiModel = flag("gemini-model") ?? process.env.OPENROUTER_GEMINI_SEARCH_MODEL ?? DEFAULT_GEMINI_MODEL;
const timeoutMs = Number(flag("timeout-ms") ?? 90_000);
const json = hasFlag("json");

const startedAt = Date.now();
const [openAiResult, geminiResult] = await Promise.all([
  runOpenAiSearch(),
  runOpenRouterGeminiSearch(),
]);

const result = {
  query,
  elapsedMs: Date.now() - startedAt,
  runs: [openAiResult, geminiResult],
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}

async function runOpenAiSearch(): Promise<ModelRunResult> {
  const started = Date.now();
  if (!process.env.OPENAI_API_KEY) {
    return failed("openai", openAiModel, started, "Missing OPENAI_API_KEY.");
  }

  try {
    const response = await generateText({
      model: openai.responses(openAiModel),
      output: Output.object({
        schema: SearchComparisonSchema,
        name: "openai_search_comparison",
      }),
      tools: {
        web_search: openai.tools.webSearch({
          searchContextSize: "low",
          externalWebAccess: true,
        }),
      },
      toolChoice: { type: "tool", toolName: "web_search" },
      providerOptions: {
        openai: {
          store: false,
          serviceTier: "flex",
          reasoningSummary: "auto",
          textVerbosity: "low",
          promptCacheKey: "cassie-search-comparison-openai",
        },
      },
      prompt: buildPrompt(query, "OpenAI web search"),
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    return {
      ok: true,
      provider: "openai",
      model: openAiModel,
      elapsedMs: Date.now() - started,
      output: response.output,
      text: response.text,
      reasoning: response.reasoning ?? null,
      sources: response.sources ?? [],
      toolCalls: response.toolCalls ?? [],
      toolResults: response.toolResults ?? [],
      usage: response.totalUsage,
      error: null,
    };
  } catch (error) {
    return failed("openai", openAiModel, started, errorMessage(error));
  }
}

async function runOpenRouterGeminiSearch(): Promise<ModelRunResult> {
  const started = Date.now();
  if (!process.env.OPENROUTER_API_KEY) {
    return failed("openrouter", geminiModel, started, "Missing OPENROUTER_API_KEY.");
  }

  try {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
      compatibility: "strict",
      extraBody: {
        provider: {
          allow_fallbacks: true,
          require_parameters: true,
        },
        reasoning: {
          effort: "minimal",
        },
      },
    });

    const response = await generateText({
      model: openrouter(geminiModel),
      output: Output.object({
        schema: SearchComparisonSchema,
        name: "gemini_search_comparison",
      }),
      prompt: buildPrompt(query, "OpenRouter Gemini 2.5 Flash online search"),
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    return {
      ok: true,
      provider: "openrouter",
      model: geminiModel,
      elapsedMs: Date.now() - started,
      output: response.output,
      text: response.text,
      reasoning: response.reasoning ?? null,
      sources: response.sources ?? [],
      toolCalls: response.toolCalls ?? [],
      toolResults: response.toolResults ?? [],
      usage: response.totalUsage,
      error: null,
    };
  } catch (error) {
    return failed("openrouter", geminiModel, started, errorMessage(error));
  }
}

function buildPrompt(input: string, laneName: string): string {
  return `You are comparing search quality for Cassie's research stack.

Lane under test: ${laneName}

Task:
Use live search if available. Answer the user's research query in the requested JSON schema.

Rules:
- Do not expose private chain-of-thought.
- Put only a concise reasoning summary in visibleThinkingSummary.
- Distinguish verified facts from interpretation.
- Prefer primary or reputable sources.
- Note when search did not find enough evidence.
- Keep each list item short.

Research query:
${input}`;
}

function failed(
  provider: "openai" | "openrouter",
  model: string,
  started: number,
  error: string,
): ModelRunResult {
  return {
    ok: false,
    provider,
    model,
    elapsedMs: Date.now() - started,
    output: null,
    text: null,
    reasoning: null,
    sources: [],
    toolCalls: [],
    toolResults: [],
    usage: null,
    error,
  };
}

function printHuman(result: { query: string; elapsedMs: number; runs: ModelRunResult[] }) {
  console.log(`Cassie search model comparison`);
  console.log(`Query: ${result.query}`);
  console.log(`Total elapsed: ${result.elapsedMs}ms`);
  console.log("");

  for (const run of result.runs) {
    console.log(`${run.provider} :: ${run.model}`);
    console.log(`status: ${run.ok ? "ok" : "failed"} | elapsed: ${run.elapsedMs}ms`);
    if (run.error) {
      console.log(`error: ${run.error}`);
      console.log("");
      continue;
    }

    console.log(`usage: ${JSON.stringify(run.usage)}`);
    console.log(`sources: ${run.sources.length}`);
    console.log(`toolCalls: ${run.toolCalls.length}`);
    console.log(`toolResults: ${run.toolResults.length}`);
    console.log(`reasoning: ${run.reasoning ? JSON.stringify(run.reasoning) : "not exposed"}`);
    console.log("");
    console.log(`answer:\n${run.output?.directAnswer}`);
    console.log("");
    console.log(`visible thinking summary:\n${run.output?.visibleThinkingSummary}`);
    console.log("");
    printList("key findings", run.output?.keyFindings ?? []);
    printList("source quality notes", run.output?.sourceQualityNotes ?? []);
    printList("unresolved questions", run.output?.unresolvedQuestions ?? []);
    console.log("");
    if (run.sources.length > 0) {
      console.log(`raw sources:`);
      console.log(JSON.stringify(run.sources, null, 2));
      console.log("");
    }
  }
}

function printList(label: string, values: string[]) {
  console.log(`${label}:`);
  if (values.length === 0) {
    console.log("- none");
    return;
  }
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function flag(name: string): string | null {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === exact) {
      return process.argv[index + 1] ?? null;
    }
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
