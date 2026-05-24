import {
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
  hasToolCall,
  stepCountIs,
} from "ai";
import type { createCassieSupervisorTools } from "./tools.ts";

export type CassieSupervisorTools = ReturnType<typeof createCassieSupervisorTools>;
export type CassieSupervisorToolName = keyof CassieSupervisorTools;

export function createCassieStopConditions(): StopCondition<CassieSupervisorTools>[] {
  return [
    hasToolCall("finalize_run"),
    stepCountIs(12),
  ];
}

export const prepareCassieSupervisorStep: PrepareStepFunction<CassieSupervisorTools> = ({ steps, messages }) => {
  const toolError = latestToolError(steps);
  if (toolError && !toolError.recoverable) {
    throw new Error(`Supervisor tool ${toolError.toolName} failed: ${toolError.error}`);
  }

  const activeTools = selectActiveTools(steps);
  const compressedMessages = compressSupervisorMessages(messages);
  return {
    activeTools,
    messages: appendSupervisorStateMessage(compressedMessages, steps, activeTools) as never,
    toolChoice: toolChoiceForActiveTools(activeTools),
  };
};

export function selectActiveTools(
  steps: Array<Pick<StepResult<ToolSet>, "toolCalls" | "toolResults">>,
): CassieSupervisorToolName[] {
  if (hasSucceeded(steps, "finalize_run")) {
    return [];
  }

  if (latestToolOutput(steps, "create_trade_ticket")) {
    return ["finalize_run"];
  }

  const riskDecision = objectRecord(latestToolOutput(steps, "risk_check"));
  if (riskDecision.decision) {
    return riskDecision.decision === "reject"
      ? ["finalize_run"]
      : ["create_trade_ticket"];
  }

  const marketSelection = objectRecord(latestToolOutput(steps, "rank_expressions"));
  if (hasOwn(marketSelection, "selectedMarket") || marketSelection.decision === "no_selection" || marketSelection.noTradeReason) {
    return marketSelection.selectedMarket && !marketSelection.noTradeReason
      ? ["risk_check"]
      : ["finalize_run"];
  }

  const marketCandidates = latestToolOutput(steps, "search_venues");
  if (marketCandidates) {
    if (!Array.isArray(marketCandidates) || marketCandidates.length === 0) {
      return ["finalize_run"];
    }

    const fitAssessments = toolOutputsAfterLatest(steps, "assess_expression_fit", "search_venues")
      .map(objectRecord)
      .filter((assessment) => typeof assessment.fitStatus === "string");
    if (fitAssessments.length < marketCandidates.length) {
      return ["assess_expression_fit"];
    }

    const validatedFitAssessments = fitAssessments.filter((assessment) => assessment.fitStatus === "validated");
    if (validatedFitAssessments.length === 0) {
      return ["finalize_run"];
    }

    const quotes = toolOutputsAfterLatest(steps, "quote_expression", "search_venues");
    if (quotes.length < validatedFitAssessments.length) {
      return ["quote_expression"];
    }

    const xSentiment = latestToolOutput(steps, "check_x_sentiment");
    if (!xSentiment) {
      return ["check_x_sentiment"];
    }
    return ["rank_expressions"];
  }

  const tradeExpression = objectRecord(latestToolOutput(steps, "generate_trade_expressions"));
  if (tradeExpression.decision) {
    return tradeExpression.decision === "no_trade"
      ? ["finalize_run"]
      : ["search_venues"];
  }

  if (latestToolOutput(steps, "frame_opportunity")) {
    return ["generate_trade_expressions"];
  }

  if (latestToolOutput(steps, "resolve_source")) {
    return ["frame_opportunity"];
  }

  return ["resolve_source", "frame_opportunity"];
}

function hasSucceeded(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  toolName: string,
): boolean {
  return steps.some((step) => step.toolResults.some((result) => result.toolName === toolName));
}

function latestToolOutput(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  toolName: string,
): unknown {
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const toolResults = steps[stepIndex]?.toolResults ?? [];
    for (let resultIndex = toolResults.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const result = toolResults[resultIndex];
      if (result.toolName === toolName) {
        return result.output;
      }
    }
  }
  return undefined;
}

function toolOutputsAfterLatest(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  toolName: string,
  afterToolName: string,
): unknown[] {
  const flattened = steps.flatMap((step) => step.toolResults);
  const afterIndex = latestToolResultIndex(flattened, afterToolName);
  return flattened
    .slice(afterIndex + 1)
    .filter((result) => result.toolName === toolName)
    .map((result) => result.output);
}

function latestToolResultIndex(
  toolResults: Array<{ toolName: string }>,
  toolName: string,
): number {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    if (toolResults[index]?.toolName === toolName) return index;
  }
  return -1;
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

  const rawOutput = part.output ?? part.result;
  const output = isRecord(rawOutput) ? rawOutput : null;
  return {
    type: part.type,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: {
      type: "json",
      value: {
        compressed: true,
        originalChars,
        result: summarizeToolOutput(rawOutput),
        status: output?.status,
        sentimentDirection: output?.sentimentDirection,
        attentionLevel: output?.attentionLevel,
        novelty: output?.novelty,
        crowdingRisk: output?.crowdingRisk,
        correctionRisk: output?.correctionRisk,
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

function toolChoiceForActiveTools(activeTools: CassieSupervisorToolName[]) {
  if (activeTools.length === 0) return "none";
  if (activeTools.length === 1) {
    return { type: "tool" as const, toolName: activeTools[0]! };
  }
  return "required";
}

function appendSupervisorStateMessage(
  messages: unknown[],
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  activeTools: CassieSupervisorToolName[],
): unknown[] {
  const state = buildSupervisorState(steps, activeTools);
  if (!state) return messages;

  return [
    ...messages,
    {
      role: "user",
      content: [
        "Authoritative persisted supervisor state for the next tool call.",
        "Use these tool results as real Cassie outputs when forming the next tool input.",
        JSON.stringify(state),
      ].join("\n"),
    },
  ];
}

function buildSupervisorState(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  activeTools: CassieSupervisorToolName[],
) {
  if (activeTools.length === 0) return null;

  return {
    activeTools,
    nextTool: activeTools.length === 1 ? activeTools[0] : null,
    venueDiscoveryProgress: buildVenueDiscoveryProgress(steps),
    latestToolResults: Object.fromEntries(
      ([
        "resolve_source",
        "frame_opportunity",
        "generate_trade_expressions",
        "search_venues",
        "assess_expression_fit",
        "quote_expression",
        "check_x_sentiment",
        "rank_expressions",
        "risk_check",
        "create_trade_ticket",
      ] satisfies CassieSupervisorToolName[])
        .map((toolName) => [toolName, latestToolOutput(steps, toolName)] as const)
        .filter(([, output]) => output !== undefined)
        .map(([toolName, output]) => [toolName, summarizeToolOutput(output)]),
    ),
  };
}

function buildVenueDiscoveryProgress(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
) {
  const candidates = latestToolOutput(steps, "search_venues");
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const fitAssessments = toolOutputsAfterLatest(steps, "assess_expression_fit", "search_venues")
    .map(objectRecord)
    .filter((assessment) => typeof assessment.fitStatus === "string");
  const validatedFitAssessments = fitAssessments.filter((assessment) => assessment.fitStatus === "validated");
  const validatedCandidateIndexes = fitAssessments
    .map((assessment, index) => assessment.fitStatus === "validated" ? index : null)
    .filter((index): index is number => index !== null);
  const quotes = toolOutputsAfterLatest(steps, "quote_expression", "search_venues");
  const nextUnquotedCandidateIndex = validatedCandidateIndexes[quotes.length] ?? null;

  return {
    candidateCount: candidates.length,
    fitAssessmentCount: fitAssessments.length,
    validatedFitCount: validatedFitAssessments.length,
    quoteCount: quotes.length,
    nextUnassessedCandidate: fitAssessments.length < candidates.length
      ? summarizeToolOutput(candidates[fitAssessments.length])
      : null,
    nextUnquotedCandidate: fitAssessments.length >= candidates.length && quotes.length < validatedFitAssessments.length
      ? summarizeToolOutput(candidates[nextUnquotedCandidateIndex ?? quotes.length])
      : null,
    readyToRank: fitAssessments.length >= candidates.length
      && validatedFitAssessments.length > 0
      && quotes.length >= validatedFitAssessments.length,
  };
}

function summarizeToolOutput(output: unknown): unknown {
  if (Array.isArray(output)) {
    return {
      count: output.length,
      items: output.slice(0, 8).map((item) => summarizeToolOutput(item)),
      omittedItems: Math.max(0, output.length - 8),
    };
  }

  if (!isRecord(output)) {
    return typeof output === "string" ? truncate(output, 800) : output ?? null;
  }

  return Object.fromEntries(
    Object.entries(output)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, summarizeToolValue(value)]),
  );
}

function summarizeToolValue(value: unknown): unknown {
  if (typeof value === "string") return truncate(value, 800);
  if (Array.isArray(value)) {
    return value.length <= 8
      ? value.map((item) => summarizeToolOutput(item))
      : {
        count: value.length,
        items: value.slice(0, 8).map((item) => summarizeToolOutput(item)),
        omittedItems: value.length - 8,
      };
  }
  if (isRecord(value)) return summarizeToolOutput(value);
  return value ?? null;
}

function truncate(value: string | null, length: number) {
  return value && value.length > length ? `${value.slice(0, length)}...` : value;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
