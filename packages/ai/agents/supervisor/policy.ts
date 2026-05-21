import {
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
  hasToolCall,
  stepCountIs,
} from "ai";
import type { IntentResult, RiskDecision } from "../../../core/schemas/index.ts";
import type { createCassieSupervisorTools } from "./tools.ts";

export type CassieSupervisorTools = ReturnType<typeof createCassieSupervisorTools>;
export type CassieSupervisorToolName = keyof CassieSupervisorTools;

export function createCassieStopConditions(maxSteps: number): StopCondition<CassieSupervisorTools>[] {
  return [
    stepCountIs(maxSteps),
    stopIfModelContinuesAfterFinalize,
  ];
}

export const prepareCassieSupervisorStep: PrepareStepFunction<CassieSupervisorTools> = ({ steps }) => {
  const toolError = latestToolError(steps);
  if (toolError) {
    throw new Error(`Supervisor tool ${toolError.toolName} failed: ${toolError.error}`);
  }

  const activeTools = selectActiveTools(steps);
  return {
    activeTools,
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

function stopIfModelContinuesAfterFinalize({ steps }: { steps: StepResult<CassieSupervisorTools>[] }): boolean {
  return hasToolCall("finalize_run")({ steps }) && steps.at(-1)?.toolCalls.some(
    (call) => call.toolName !== "finalize_run",
  ) === true;
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
    for (let contentIndex = step.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const part = step.content[contentIndex];
      if (part.type !== "tool-error") continue;
      return {
        toolName: String(part.toolName),
        error: part.error instanceof Error ? part.error.message : String(part.error),
      };
    }
  }
  return null;
}
