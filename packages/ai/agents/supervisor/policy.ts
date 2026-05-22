import {
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
  hasToolCall,
} from "ai";
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
  if (toolError && !toolError.recoverable) {
    throw new Error(`Supervisor tool ${toolError.toolName} failed: ${toolError.error}`);
  }

  const activeTools = selectActiveTools(steps);
  return {
    activeTools,
    messages: compressSupervisorMessages(messages) as never,
  };
};

export function selectActiveTools(
  steps: Array<Pick<StepResult<ToolSet>, "toolCalls" | "toolResults">>,
): CassieSupervisorToolName[] {
  if (hasSucceeded(steps, "finalize_run")) {
    return [];
  }

  return [
    "classify_intent",
    "interpret_signal",
    "extract_thesis",
    "extract_inverse_thesis",
    "research_thesis",
    "critique_thesis",
    "plan_trade_expression",
    "find_polymarket_markets",
    "assess_polymarket_market",
    "quote_polymarket_market",
    "select_market",
    "risk_check",
    "create_trade_ticket",
    "finalize_run",
  ];
}

function hasSucceeded(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  toolName: string,
): boolean {
  return steps.some((step) => step.toolResults.some((result) => result.toolName === toolName));
}

function latestToolError(steps: Array<{ content: Array<{ type: string; toolName?: string; error?: unknown }> }>): { toolName: string; error: string; recoverable: boolean } | null {
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex];
    const content = Array.isArray(step.content) ? step.content : [];
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const part = content[contentIndex];
      if (part.type !== "tool-error") continue;
      const error = part.error instanceof Error ? part.error.message : String(part.error);
      return {
        toolName: String(part.toolName),
        error,
        recoverable: isRecoverablePrerequisiteError(part.error),
      };
    }
  }
  return null;
}

function isRecoverablePrerequisiteError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "SupervisorPrerequisiteError" || error.message.startsWith("SUPERVISOR_PREREQUISITE:");
  }
  return typeof error === "string" && error.startsWith("SUPERVISOR_PREREQUISITE:");
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
        decision: output?.decision,
        directAsset: truncate(typeof output?.directAsset === "string" ? output.directAsset : null, 120),
        highestPurityExpression: truncate(typeof output?.highestPurityExpression === "string" ? output.highestPurityExpression : null, 260),
        marketRouterInstructions: truncate(typeof output?.marketRouterInstructions === "string" ? output.marketRouterInstructions : null, 260),
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
