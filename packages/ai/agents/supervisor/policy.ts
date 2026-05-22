import {
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
  hasToolCall,
} from "ai";
import type { IntentResult, RiskDecision, TradeExpressionPlan } from "../../../core/schemas/index.ts";
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

  const active = new Set<CassieSupervisorToolName>();
  const intent = getLatestToolOutput<IntentResult>(steps, "classify_intent")?.intent;
  const expression = getLatestToolOutput<TradeExpressionPlan>(steps, "plan_trade_expression");
  const riskDecision = getLatestToolOutput<RiskDecision>(steps, "risk_check");

  if (!hasSucceeded(steps, "classify_intent")) active.add("classify_intent");
  if (!hasSucceeded(steps, "interpret_signal")) active.add("interpret_signal");
  if (!hasSucceeded(steps, "extract_thesis")) active.add("extract_thesis");

  if (intent === "countertrade" && !hasSucceeded(steps, "extract_inverse_thesis")) {
    active.add("extract_inverse_thesis");
  }

  if (hasSucceeded(steps, "extract_thesis")) {
    if (!hasSucceeded(steps, "research_thesis")) active.add("research_thesis");
    active.add("plan_trade_expression");
  }

  if (hasSucceeded(steps, "research_thesis")) {
    active.add("critique_thesis");
    active.add("plan_trade_expression");
  }

  if (expression && shouldRouteToMarket(expression)) {
    const nextMarketTool = selectNextMarketTool(steps, expression);
    if (nextMarketTool) active.add(nextMarketTool);
    active.add("select_market");
  }

  if (hasUsableMarketSelection(steps) && !hasSucceeded(steps, "risk_check")) {
    active.add("risk_check");
  }

  if (
    riskDecision &&
    riskDecision.decision !== "reject" &&
    !hasSucceeded(steps, "create_trade_ticket")
  ) {
    active.add("create_trade_ticket");
  }

  if (canFinalize(steps, intent)) {
    active.add("finalize_run");
  }

  return orderedTools(active);
}

function orderedTools(active: Set<CassieSupervisorToolName>): CassieSupervisorToolName[] {
  const order: CassieSupervisorToolName[] = [
    "classify_intent",
    "interpret_signal",
    "extract_thesis",
    "extract_inverse_thesis",
    "research_thesis",
    "critique_thesis",
    "plan_trade_expression",
    "find_polymarket_markets",
    "select_market",
    "risk_check",
    "create_trade_ticket",
    "finalize_run",
  ];
  return order.filter((toolName) => active.has(toolName));
}

function selectNextMarketTool(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  expression: TradeExpressionPlan,
): "find_polymarket_markets" | "select_market" | null {
  if (!shouldRouteToMarket(expression)) return null;
  if (shouldCheckPolymarket(expression) && !hasSucceeded(steps, "find_polymarket_markets")) {
    return "find_polymarket_markets";
  }
  if (!hasSucceeded(steps, "select_market")) return "select_market";
  return null;
}

function shouldRouteToMarket(expression: TradeExpressionPlan): boolean {
  return expression.decision === "needs_market_check" ||
    (
      expression.decision === "route_to_market_router" &&
      expression.candidates.some((candidate) => candidate.tradableNow)
    );
}

function shouldCheckPolymarket(expression: TradeExpressionPlan): boolean {
  const searchable = [
    expression.highestPurityExpression,
    expression.marketRouterInstructions,
    ...expression.candidates.flatMap((candidate) => [
      candidate.venue,
      candidate.instrumentType,
      candidate.venueQuery,
      ...(candidate.venueChecks ?? []),
    ]),
  ].filter((value): value is string => Boolean(value)).join(" ").toLowerCase();

  return expression.decision === "needs_market_check" ||
    searchable.includes("polymarket") ||
    searchable.includes("prediction_market") ||
    searchable.includes("prediction market");
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

function hasUsableMarketSelection(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
): boolean {
  const selection = getLatestToolOutput<{ selectedMarket?: unknown; noTradeReason?: unknown }>(steps, "select_market");
  return Boolean(selection?.selectedMarket) && !selection?.noTradeReason;
}

function canFinalize(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  intent: IntentResult["intent"] | undefined,
): boolean {
  if (!hasSucceeded(steps, "classify_intent") || !hasSucceeded(steps, "interpret_signal") || !hasSucceeded(steps, "extract_thesis")) {
    return false;
  }

  if (!intent) return false;

  if (intent === "critic") {
    return hasSucceeded(steps, "critique_thesis") || hasSucceeded(steps, "plan_trade_expression");
  }

  if (intent === "trade" || intent === "countertrade") {
    return hasSucceeded(steps, "plan_trade_expression") ||
      hasSucceeded(steps, "risk_check") ||
      hasSucceeded(steps, "create_trade_ticket");
  }

  if (intent === "watch") {
    return hasSucceeded(steps, "research_thesis") && hasSucceeded(steps, "plan_trade_expression");
  }

  return hasSucceeded(steps, "research_thesis") || hasSucceeded(steps, "plan_trade_expression");
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
