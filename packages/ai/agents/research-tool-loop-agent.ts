import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ToolLoopAgent, hasToolCall, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  DEFAULT_CHEAP_MODEL,
  DEFAULT_EXPENSIVE_MODEL,
} from "../client.ts";
import { openAiCostControlOptions } from "../openai-options.ts";

const WEB_SEARCH_MODEL = process.env.CASSIE_WEB_SEARCH_MODEL ??
  process.env.OPENROUTER_WEB_SEARCH_MODEL ??
  "google/gemini-3.1-flash-lite";

type ResearchToolName =
  | "create_query_jobs"
  | "run_web_query"
  | "run_x_query"
  | "classify_evidence"
  | "resolve_goal"
  | "decide_continuation"
  | "propose_adaptive_queries"
  | "done";

type StepLike = {
  toolCalls?: Array<{ toolName?: string }>;
  toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
};

type PrepareInput = {
  stepNumber: number;
  steps: StepLike[];
  messages: unknown[];
};

export function createResearchToolLoopAgent() {
  return new ToolLoopAgent({
    id: "cassie-research-tool-loop",
    model: openRouterModel(WEB_SEARCH_MODEL),
    instructions: researchToolLoopInstructions(),
    tools: researchTools(),
    toolChoice: "required",
    stopWhen: [hasToolCall("done"), stepCountIs(14)],
    prepareStep: prepareResearchToolLoopStep as never,
  });
}

export async function prepareResearchToolLoopStep(input: PrepareInput) {
  const activeTools = chooseActiveTools(input.steps);
  const model = modelForTools(activeTools);

  return {
    model,
    activeTools,
    toolChoice: toolChoiceForTools(activeTools),
    messages: compressResearchToolMessages(input.messages),
    providerOptions: openAiProviderOptionsForTools(activeTools),
  };
}

export function compressResearchToolMessages(messages: unknown[]) {
  return messages.map((message) => {
    if (!isRecord(message) || message.role !== "tool") {
      return message;
    }

    const serialized = JSON.stringify(message);
    if (serialized.length <= 1000) {
      return message;
    }

    return {
      ...message,
      content: [
        {
          type: "tool-result",
          toolCallId: "compressed",
          toolName: "compressed_research_tool_result",
          output: {
            type: "json",
            value: compressToolPayload(message),
          },
        },
      ],
    };
  });
}

export function extractDoneAnswer(result: unknown): string | null {
  const calls = isRecord(result) && Array.isArray(result.staticToolCalls) ? result.staticToolCalls : [];
  const done = calls.find((call) => isRecord(call) && call.toolName === "done");
  if (!isRecord(done)) {
    return null;
  }

  const input = isRecord(done.input) ? done.input : null;
  return typeof input?.answer === "string" ? input.answer : null;
}

function researchTools() {
  return {
    create_query_jobs: tool({
      description: "Compile the approved research plan into auditable query jobs.",
      inputSchema: z.object({
        reason: z.string(),
      }),
      execute: async (input) => ({ status: "planned", ...input }),
    }),
    run_web_query: tool({
      description: "Run one auditable OpenRouter web-search query job and return raw search result metadata.",
      inputSchema: z.object({
        queryJobId: z.string(),
        query: z.string(),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    run_x_query: tool({
      description: "Run one auditable X query job and return raw post/result metadata.",
      inputSchema: z.object({
        queryJobId: z.string(),
        query: z.string(),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    classify_evidence: tool({
      description: "Classify retrieved results into SearchResult, EvidenceClaim, and GoalEvidenceLink ledger items.",
      inputSchema: z.object({
        queryJobIds: z.array(z.string()),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    resolve_goal: tool({
      description: "Resolve research goals from the classified evidence ledger.",
      inputSchema: z.object({
        goalIds: z.array(z.string()),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    decide_continuation: tool({
      description: "Decide whether to stop, continue planned waves, or request adaptive queries.",
      inputSchema: z.object({
        reason: z.string(),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    propose_adaptive_queries: tool({
      description: "Propose bounded adaptive follow-up queries for unresolved high-impact evidence gaps.",
      inputSchema: z.object({
        unresolvedGoalIds: z.array(z.string()),
      }),
      execute: async (input) => ({ status: "queued_for_host_pipeline", ...input }),
    }),
    done: tool({
      description: "Signal that the constrained research loop is complete.",
      inputSchema: z.object({
        answer: z.string(),
      }),
    }),
  };
}

function chooseActiveTools(steps: StepLike[]): ResearchToolName[] {
  const lastTool = lastToolName(steps);
  const lastDecision = lastContinuationAction(steps);

  if (!lastTool) {
    return ["create_query_jobs"];
  }
  if (lastDecision === "continue_with_adaptive_queries") {
    return ["propose_adaptive_queries"];
  }
  if (lastDecision && lastDecision !== "continue_planned") {
    return ["done"];
  }

  switch (lastTool) {
    case "create_query_jobs":
    case "propose_adaptive_queries":
      return ["run_web_query", "run_x_query"];
    case "run_web_query":
    case "run_x_query":
      return ["classify_evidence"];
    case "classify_evidence":
      return ["resolve_goal"];
    case "resolve_goal":
      return ["decide_continuation"];
    case "decide_continuation":
      return ["done"];
    default:
      return ["done"];
  }
}

function modelForTools(activeTools: ResearchToolName[]) {
  if (activeTools.some((name) => name === "run_web_query" || name === "run_x_query" || name === "create_query_jobs")) {
    return openRouterModel(WEB_SEARCH_MODEL);
  }
  if (activeTools.includes("classify_evidence")) {
    return openRouterModel(process.env.CASSIE_CHEAP_MODEL ?? process.env.OPENROUTER_CHEAP_MODEL ?? DEFAULT_CHEAP_MODEL);
  }
  return openai(
    process.env.CASSIE_IMPORTANT_MODEL ??
      process.env.CASSIE_EXPENSIVE_MODEL ??
      process.env.CASSIE_MODEL ??
      DEFAULT_EXPENSIVE_MODEL,
  );
}

function toolChoiceForTools(activeTools: ResearchToolName[]) {
  return activeTools.length === 1
    ? { type: "tool" as const, toolName: activeTools[0] }
    : "required" as const;
}

function openAiProviderOptionsForTools(activeTools: ResearchToolName[]) {
  if (
    activeTools.includes("classify_evidence") ||
    activeTools.some((name) => name === "run_web_query" || name === "run_x_query" || name === "create_query_jobs")
  ) {
    return undefined;
  }

  return openAiCostControlOptions({
    promptCacheKey: `cassie-research-tool-loop-${activeTools.join("-")}`,
  });
}

function openRouterModel(model: string) {
  const reasoning = model.includes("gemini-3.1-flash-lite") ? { effort: "minimal" } : undefined;
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    compatibility: "strict",
    extraBody: {
      provider: { allow_fallbacks: true, require_parameters: true },
      ...(reasoning ? { reasoning } : {}),
    },
  });
  return openrouter(model);
}

function lastToolName(steps: StepLike[]): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    const resultTool = step?.toolResults?.at(-1)?.toolName;
    if (resultTool) return resultTool;
    const callTool = step?.toolCalls?.at(-1)?.toolName;
    if (callTool) return callTool;
  }

  return null;
}

function lastContinuationAction(steps: StepLike[]): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const result = steps[index]?.toolResults?.find((candidate) => candidate.toolName === "decide_continuation");
    const payload = isRecord(result?.output) ? result.output : isRecord(result?.result) ? result.result : null;
    const action = typeof payload?.action === "string" ? payload.action : null;
    if (action) return action;
  }

  return null;
}

function compressToolPayload(message: Record<string, unknown>) {
  const text = JSON.stringify(message);
  return {
    compressed: true,
    originalChars: text.length,
    summary: text.slice(0, 500),
    counts: {
      searchResults: countPattern(text, "searchResults"),
      evidenceClaims: countPattern(text, "evidenceClaims"),
      goalEvidenceLinks: countPattern(text, "goalEvidenceLinks"),
      goalResolutions: countPattern(text, "goalResolutions"),
    },
  };
}

function countPattern(value: string, pattern: string) {
  return value.includes(pattern) ? 1 : 0;
}

function researchToolLoopInstructions() {
  return `You are Cassie's constrained research tool loop.

You must use tools at every step. Never answer directly during research.
Move through the phases: create query jobs, run web/X query jobs, classify evidence, resolve goals, decide continuation, optionally propose adaptive queries, then call done.
Use done only when the research ledger and continuation decision are ready for the host pipeline to synthesize.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
