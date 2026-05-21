import "dotenv/config";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Output, generateText } from "ai";
import { z } from "zod";
import { openRouterProviderOptions, openRouterProviderPreferences } from "../packages/ai/openrouter-options.ts";

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

const SmokeResultSchema = z.object({
  signalType: z.enum([
    "funding",
    "valuation_critique",
    "product_launch",
    "explicit_trade",
    "generic_opinion",
    "unknown",
  ]),
  entities: z.array(z.string()).min(1),
  thesis: z.string().min(1),
  shouldResearch: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const prompt = flag("prompt") ??
  "JaguarAnalytics says SPCX/SpaceX is worth $1.75T while reporting $18.7B 2025 sales and operating losses, citing an S-1.";

const model = flag("model") ?? process.env.CASSIE_CHEAP_MODEL ?? process.env.OPENROUTER_CHEAP_MODEL ?? DEFAULT_MODEL;
const timeoutMs = Number(flag("timeout-ms") ?? 45_000);

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY. Add it to .env or export it before running this smoke test.");
}

const startedAt = Date.now();
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  compatibility: "strict",
  extraBody: {
    provider: openRouterProviderPreferences(),
  },
});

const result = await generateText({
  model: openrouter(model),
  output: Output.object({
    schema: SmokeResultSchema,
    name: "deepseek_v4_flash_smoke_result",
  }),
  prompt: buildPrompt(prompt),
  providerOptions: openRouterProviderOptions(),
  abortSignal: AbortSignal.timeout(timeoutMs),
});

const elapsedMs = Date.now() - startedAt;

console.log(JSON.stringify({
  ok: true,
  provider: "openrouter",
  model,
  elapsedMs,
  totalUsage: result.totalUsage,
  output: result.output,
}, null, 2));

function buildPrompt(input: string): string {
  return `You are testing Cassie's cheap AI bookkeeping model.

Task:
Classify this social/trading signal into the requested JSON schema.

Rules:
- Do not make a trade recommendation.
- Do not invent entities not present or directly implied by the text.
- Keep thesis to one sentence.
- Set shouldResearch true only if the text contains a concrete entity, event, metric, or market claim worth checking.

Signal:
${input}`;
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
