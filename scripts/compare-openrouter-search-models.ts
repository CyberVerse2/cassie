import "dotenv/config";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Output, generateText } from "ai";
import { z } from "zod";

const DEFAULT_MODEL_A = "google/gemini-3.1-flash-lite";
const DEFAULT_MODEL_B = "google/gemini-2.5-flash";
const DEFAULT_MODELS = [
  "deepseek/deepseek-v4-flash",
  "google/gemini-2.5-flash",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3-flash-preview",
];

const ComparisonSchema = z.object({
  directAnswer: z.string(),
  visibleThinkingSummary: z.string(),
  keyFindings: z.array(z.string()),
  sourceQualityNotes: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
});

type RunResult = {
  ok: boolean;
  model: string;
  elapsedMs: number;
  output: z.infer<typeof ComparisonSchema> | null;
  text: string | null;
  reasoning: unknown;
  sources: unknown[];
  usage: unknown;
  error: string | null;
};

const query = flag("query") ??
  "Search and critique the claim that Exa raised $250M at a $2.2B valuation led by a16z. What is verified, what matters, and what remains unresolved?";
const modelA = flag("model-a") ?? DEFAULT_MODEL_A;
const modelB = flag("model-b") ?? DEFAULT_MODEL_B;
const models = (flag("models")?.split(",").map((model) => model.trim()).filter(Boolean)) ?? [modelA, modelB];
const timeoutMs = Number(flag("timeout-ms") ?? 90_000);
const json = hasFlag("json");
const forceWebPlugin = !hasFlag("no-web-plugin");
const maxResults = Number(flag("max-results") ?? 5);
const searchEngine = flag("search-engine") ?? process.env.OPENROUTER_WEB_SEARCH_ENGINE ?? "native";
const rawSources = hasFlag("raw-sources");

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY. Add it to .env or export it before running this comparison.");
}

const startedAt = Date.now();
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  compatibility: "strict",
  extraBody: {
    provider: {
      allow_fallbacks: true,
      require_parameters: true,
    },
    ...(forceWebPlugin
      ? {
        plugins: [
          {
            id: "web",
            max_results: maxResults,
            engine: searchEngine,
          },
        ],
      }
      : {}),
    reasoning: {
      effort: "minimal",
    },
  },
});

const selectedModels = hasFlag("default-four") ? DEFAULT_MODELS : models;
const runs = await Promise.all(selectedModels.map((model, index) => runModel(model, `model_${index + 1}`)));

const result = {
  query,
  elapsedMs: Date.now() - startedAt,
  searchEngine: forceWebPlugin ? searchEngine : null,
  runs,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}

async function runModel(model: string, schemaName: string): Promise<RunResult> {
  const started = Date.now();
  try {
    const response = await generateText({
      model: openrouter(model),
      output: Output.object({
        schema: ComparisonSchema,
        name: `openrouter_search_comparison_${schemaName}`,
      }),
      prompt: buildPrompt(query, model),
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    return {
      ok: true,
      model,
      elapsedMs: Date.now() - started,
      output: response.output,
      text: response.text,
      reasoning: response.reasoning ?? null,
      sources: response.sources ?? [],
      usage: response.totalUsage,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      model,
      elapsedMs: Date.now() - started,
      output: null,
      text: null,
      reasoning: null,
      sources: [],
      usage: null,
      error: errorMessage(error),
    };
  }
}

function buildPrompt(input: string, model: string): string {
  return `You are comparing OpenRouter search quality for Cassie's research stack.

Model under test: ${model}

Task:
Use live online search if available. Answer the user's research query in the requested JSON schema.

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

function printHuman(result: { query: string; elapsedMs: number; runs: RunResult[] }) {
  console.log("OpenRouter search model comparison");
  console.log(`Query: ${result.query}`);
  console.log(`Web plugin: ${forceWebPlugin ? `forced exa max_results=${maxResults}` : "disabled; use model suffix/native behavior"}`);
  console.log(`Total elapsed: ${result.elapsedMs}ms`);
  console.log("");

  for (const run of result.runs) {
    console.log(run.model);
    console.log(`status: ${run.ok ? "ok" : "failed"} | elapsed: ${run.elapsedMs}ms`);
    if (run.error) {
      console.log(`error: ${run.error}`);
      console.log("");
      continue;
    }

    console.log(`usage: ${JSON.stringify(run.usage)}`);
    console.log(`sources: ${run.sources.length}`);
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
    if (rawSources && run.sources.length > 0) {
      console.log("raw sources:");
      console.log(JSON.stringify(run.sources, null, 2));
      console.log("");
    } else if (run.sources.length > 0) {
      printSources(run.sources);
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

function printSources(sources: unknown[]) {
  console.log("sources:");
  for (const source of sources) {
    if (!isRecord(source)) {
      console.log("- unknown source");
      continue;
    }
    const title = typeof source.title === "string" ? source.title : "Untitled";
    const url = typeof source.url === "string" ? source.url : typeof source.id === "string" ? source.id : "";
    console.log(`- ${title}${url ? ` (${url})` : ""}`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
