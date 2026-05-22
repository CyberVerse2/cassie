import {
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
  hasToolCall,
} from "ai";
import type { IntentResult, RiskDecision } from "../../../core/schemas/index.ts";
import type { createCassieSupervisorTools } from "./tools.ts";

export type CassieSupervisorTools = ReturnType<typeof createCassieSupervisorTools>;
export type CassieSupervisorToolName = keyof CassieSupervisorTools;

export function createCassieStopConditions(): StopCondition<CassieSupervisorTools>[] {
  return [
    hasToolCall("finalize_run"),
  ];
}

export const prepareCassieSupervisorStep: PrepareStepFunction<CassieSupervisorTools> = ({ steps, messages }) => {
  const toolError = latestToolError(steps);
  if (toolError) {
    throw new Error(`Supervisor tool ${toolError.toolName} failed: ${toolError.error}`);
  }

  const activeTools = selectActiveTools(steps);
  return {
    activeTools,
    messages: compressSupervisorMessages(messages) as never,
    toolChoice: activeTools.length === 0
      ? "none"
      : activeTools.length === 1
        ? { type: "tool", toolName: activeTools[0] }
        : "required",
  };
};

export function selectActiveTools(
  steps: Array<Pick<StepResult<ToolSet>, "toolCalls" | "toolResults">>,
): CassieSupervisorToolName[] {
  if (hasSucceeded(steps, "finalize_run")) {
    return [];
  }

  if (!hasSucceeded(steps, "classify_intent")) {
    return ["classify_intent"];
  }

  if (!hasSucceeded(steps, "interpret_signal")) {
    return ["interpret_signal"];
  }

  if (!hasSucceeded(steps, "extract_thesis")) {
    return ["extract_thesis"];
  }

  const intent = getLatestToolOutput<IntentResult>(steps, "classify_intent")?.intent;

  if (intent === "countertrade" && !hasSucceeded(steps, "extract_inverse_thesis")) {
    return ["extract_inverse_thesis"];
  }

  if ((intent === "critic" || intent === "trade" || intent === "countertrade") && !hasSucceeded(steps, "research_thesis")) {
    return ["research_thesis"];
  }

  if (intent === "critic") {
    return hasSucceeded(steps, "critique_thesis") ? ["finalize_run"] : ["critique_thesis"];
  }

  if (!hasSucceeded(steps, "select_market")) {
    return ["select_market"];
  }

  if (!hasSucceeded(steps, "risk_check")) {
    return ["risk_check"];
  }

  const riskDecision = getLatestToolOutput<RiskDecision>(steps, "risk_check");
  if (riskDecision?.decision === "reject") {
    return ["finalize_run"];
  }

  if ((intent === "trade" || intent === "countertrade") && !hasSucceeded(steps, "create_trade_ticket")) {
    return ["create_trade_ticket"];
  }

  return ["finalize_run"];
}

function hasCalled(
  steps: Array<Pick<StepResult<ToolSet>, "toolCalls" | "toolResults">>,
  toolName: string,
): boolean {
  return steps.some((step) => step.toolCalls.some((call) => call.toolName === toolName));
}

function hasSucceeded(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  toolName: string,
): boolean {
  return steps.some((step) => step.toolResults.some((result) => result.toolName === toolName));
}

function getLatestToolOutput<T>(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  toolName: string,
): T | undefined {
  return steps
    .flatMap((step) => step.toolResults)
    .filter((result) => result.toolName === toolName)
    .at(-1)?.output as T | undefined;
}

function latestToolError(steps: Array<{ content: Array<{ type: string; toolName?: string; error?: unknown }> }>): { toolName: string; error: string } | null {
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex];
    const content = Array.isArray(step.content) ? step.content : [];
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const part = content[contentIndex];
      if (part.type !== "tool-error") continue;
      return {
        toolName: String(part.toolName),
        error: part.error instanceof Error ? part.error.message : String(part.error),
      };
    }
  }
  return null;
}

function compressSupervisorMessages(messages: unknown[]) {
  return messages.map((message) => {
    if (!isRecord(message) || message.role !== "tool") {
      return message;
    }

    const serialized = JSON.stringify(message);
    if (serialized.length <= 1200) {
      return message;
    }

    return {
      ...message,
      content: summarizeToolMessage(message, serialized.length),
    };
  });
}

function summarizeToolMessage(message: Record<string, unknown>, originalChars: number) {
  const content = Array.isArray(message.content) ? message.content : [];
  return content.map((part) => summarizeToolPart(part, originalChars)).filter(Boolean);
}

function summarizeToolPart(part: unknown, originalChars: number) {
  if (!isRecord(part)) {
    return null;
  }

  const output = isRecord(part.output) ? part.output : isRecord(part.result) ? part.result : null;
  return {
    type: part.type,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: {
      type: "json",
      value: {
        compressed: true,
        originalChars,
        status: output?.status,
        intent: output?.intent,
        signalType: output?.signalType,
        stance: output?.stance,
        publicSummary: truncate(typeof output?.publicSummary === "string" ? output.publicSummary : null, 220),
        claim: truncate(typeof output?.claim === "string" ? output.claim : null, 220),
        finalCritique: truncate(typeof output?.finalCritique === "string" ? output.finalCritique : null, 360),
        strongestObjection: truncate(typeof output?.strongestObjection === "string" ? output.strongestObjection : null, 360),
        reason: truncate(typeof output?.reason === "string" ? output.reason : null, 220),
        ticketId: truncate(typeof output?.ticketId === "string" ? output.ticketId : null, 120),
      },
    },
  };
}

function truncate(value: string | null, length: number) {
  return value && value.length > length ? `${value.slice(0, length)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
