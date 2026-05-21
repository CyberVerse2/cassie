import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Output, generateText } from "ai";
import { z } from "zod";
import { openRouterProviderPreferences } from "../packages/ai/openrouter-options.ts";

const MODELS = [
  "deepseek/deepseek-v4-flash",
  "google/gemini-2.5-flash",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3-flash-preview",
];

const QUESTIONS = [
  "Search and critique the claim that Exa raised $250M at a $2.2B valuation led by a16z. What is verified, what matters, and what remains unresolved?",
  "Search and critique the claim that Solana ETF approval is underpriced. What is the catalyst, what evidence supports or weakens it, and is there a clean trade expression?",
  "Search and critique the claim that SpaceX/SPCX is overvalued at roughly $1.75T based on an alleged S-1 and 2025 sales multiple. What is verified, what is ticker confusion, and what remains unresolved?",
  "Search and critique the claim that OpenRouter's web search is powered by Exa and costs $0.005 per request for up to 10 results. What is verified and what matters for Cassie's search-lane cost?",
  "Search and critique the claim that a new AI browser launch is materially negative for Google Search. What is verified, what would matter, and what evidence is missing before a trade?",
];

const ResponseSchema = z.object({
  directAnswer: z.string(),
  visibleThinkingSummary: z.string(),
  keyFindings: z.array(z.string()),
  sourceQualityNotes: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
});

type RunOutput = {
  ok: boolean;
  questionIndex: number;
  question: string;
  model: string;
  elapsedMs: number;
  usage: unknown;
  sourceCount: number;
  sources: Array<{ title: string | null; url: string | null }>;
  reasoningExposed: boolean;
  reasoningPreview: string | null;
  output: z.infer<typeof ResponseSchema> | null;
  error: string | null;
};

const timeoutMs = Number(flag("timeout-ms") ?? 120_000);
const maxResults = Number(flag("max-results") ?? 5);
const searchEngine = flag("search-engine") ?? process.env.OPENROUTER_WEB_SEARCH_ENGINE ?? "native";
const outputPath = resolve(flag("output") ?? `artifacts/openrouter-search-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY. Add it to .env or export it before running this eval.");
}

const startedAt = Date.now();
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  compatibility: "strict",
  extraBody: {
    provider: openRouterProviderPreferences(),
    plugins: [
      {
        id: "web",
        max_results: maxResults,
        engine: searchEngine,
      },
    ],
    reasoning: {
      effort: "minimal",
    },
  },
});

const runs: RunOutput[] = [];
for (let questionIndex = 0; questionIndex < QUESTIONS.length; questionIndex += 1) {
  const question = QUESTIONS[questionIndex];
  const round = await Promise.all(MODELS.map((model) => runModel({ model, question, questionIndex })));
  runs.push(...round);
  printRoundSummary(questionIndex, question, round);
}

const report = {
  createdAt: new Date().toISOString(),
  searchEngine,
  elapsedMs: Date.now() - startedAt,
  maxResults,
  questions: QUESTIONS,
  models: MODELS,
  runs,
  comparison: compareRuns(runs),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("");
console.log(`Wrote JSON report: ${outputPath}`);
console.log("");
printComparison(report.comparison);

async function runModel(input: {
  model: string;
  question: string;
  questionIndex: number;
}): Promise<RunOutput> {
  const started = Date.now();
  try {
    const result = await generateText({
      model: openrouter(input.model),
      output: Output.object({
        schema: ResponseSchema,
        name: `cassie_search_eval_${input.questionIndex + 1}_${safeName(input.model)}`,
      }),
      prompt: buildPrompt(input.question, input.model),
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    return {
      ok: true,
      questionIndex: input.questionIndex,
      question: input.question,
      model: input.model,
      elapsedMs: Date.now() - started,
      usage: result.totalUsage,
      sourceCount: result.sources.length,
      sources: result.sources.map((source) => sourceSummary(source)),
      reasoningExposed: Array.isArray(result.reasoning) && result.reasoning.length > 0,
      reasoningPreview: reasoningPreview(result.reasoning),
      output: result.output,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      questionIndex: input.questionIndex,
      question: input.question,
      model: input.model,
      elapsedMs: Date.now() - started,
      usage: null,
      sourceCount: 0,
      sources: [],
      reasoningExposed: false,
      reasoningPreview: null,
      output: null,
      error: errorMessage(error),
    };
  }
}

function buildPrompt(question: string, model: string): string {
  return `You are evaluating search quality for Cassie's research stack.

Model under test: ${model}

Task:
Use the provided live web context. Answer the research question in the requested JSON schema.

Rules:
- Do not expose private chain-of-thought.
- Put only a concise reasoning summary in visibleThinkingSummary.
- Distinguish verified facts from interpretation.
- Prefer primary or reputable sources.
- Note when evidence is missing or tradeability is unresolved.
- Keep each list item short.

Research question:
${question}`;
}

function compareRuns(runs: RunOutput[]) {
  return MODELS.map((model) => {
    const modelRuns = runs.filter((run) => run.model === model);
    const successes = modelRuns.filter((run) => run.ok);
    const totalTokens = successes.reduce((sum, run) => sum + tokenCount(run.usage, "totalTokens"), 0);
    const totalReasoningTokens = successes.reduce((sum, run) => sum + tokenCount(run.usage, "reasoningTokens"), 0);
    const totalSources = successes.reduce((sum, run) => sum + run.sourceCount, 0);
    const totalElapsed = successes.reduce((sum, run) => sum + run.elapsedMs, 0);
    const unresolvedCount = successes.reduce((sum, run) => sum + (run.output?.unresolvedQuestions.length ?? 0), 0);
    const reasoningExposedCount = successes.filter((run) => run.reasoningExposed).length;

    return {
      model,
      successCount: successes.length,
      failureCount: modelRuns.length - successes.length,
      avgElapsedMs: successes.length ? Math.round(totalElapsed / successes.length) : null,
      avgTotalTokens: successes.length ? Math.round(totalTokens / successes.length) : null,
      avgReasoningTokens: successes.length ? Math.round(totalReasoningTokens / successes.length) : null,
      avgSources: successes.length ? Number((totalSources / successes.length).toFixed(1)) : null,
      avgUnresolvedQuestions: successes.length ? Number((unresolvedCount / successes.length).toFixed(1)) : null,
      reasoningExposedCount,
    };
  });
}

function printRoundSummary(questionIndex: number, question: string, runs: RunOutput[]) {
  console.log("");
  console.log(`Round ${questionIndex + 1}: ${question}`);
  for (const run of runs) {
    const usage = isRecord(run.usage) ? run.usage : {};
    console.log([
      `- ${run.model}`,
      run.ok ? "ok" : "failed",
      `${run.elapsedMs}ms`,
      `tokens=${usage.totalTokens ?? "n/a"}`,
      `sources=${run.sourceCount}`,
      `unresolved=${run.output?.unresolvedQuestions.length ?? 0}`,
    ].join(" | "));
  }
}

function printComparison(comparison: ReturnType<typeof compareRuns>) {
  console.log("Model comparison:");
  for (const item of comparison) {
    console.log([
      `- ${item.model}`,
      `success=${item.successCount}/5`,
      `avgLatency=${item.avgElapsedMs}ms`,
      `avgTokens=${item.avgTotalTokens}`,
      `avgReasoning=${item.avgReasoningTokens}`,
      `avgSources=${item.avgSources}`,
      `avgUnresolved=${item.avgUnresolvedQuestions}`,
      `reasoningExposed=${item.reasoningExposedCount}/5`,
    ].join(" | "));
  }
}

function sourceSummary(source: unknown) {
  if (!isRecord(source)) {
    return { title: null, url: null };
  }

  return {
    title: typeof source.title === "string" ? source.title : null,
    url: typeof source.url === "string" ? source.url : typeof source.id === "string" ? source.id : null,
  };
}

function tokenCount(usage: unknown, key: string) {
  return isRecord(usage) && typeof usage[key] === "number" ? usage[key] : 0;
}

function reasoningPreview(reasoning: unknown) {
  if (!Array.isArray(reasoning) || reasoning.length === 0) {
    return null;
  }

  const text = reasoning
    .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  return text ? text.slice(0, 500) : null;
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
