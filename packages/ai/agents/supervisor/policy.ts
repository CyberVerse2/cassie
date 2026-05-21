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
  if (hasCalled(steps, "finalize_run")) {
    return [];
  }

  if (!hasCalled(steps, "classify_intent")) {
    return ["classify_intent"];
  }

  if (!hasCalled(steps, "interpret_signal")) {
    return ["interpret_signal"];
  }

  if (!hasCalled(steps, "extract_thesis")) {
    return ["extract_thesis"];
  }

  const intent = getLatestToolOutput<IntentResult>(steps, "classify_intent")?.intent;

  if (intent === "countertrade" && !hasCalled(steps, "extract_inverse_thesis")) {
    return ["extract_inverse_thesis"];
  }

  if ((intent === "critic" || intent === "trade" || intent === "countertrade") && !hasCalled(steps, "research_thesis")) {
    return ["research_thesis"];
  }

  if (intent === "critic") {
    return hasCalled(steps, "critique_thesis") ? ["finalize_run"] : ["critique_thesis"];
  }

  if (!hasCalled(steps, "select_market")) {
    return ["select_market"];
  }

  if (!hasCalled(steps, "risk_check")) {
    return ["risk_check"];
  }

  const riskDecision = getLatestToolOutput<RiskDecision>(steps, "risk_check");
  if (riskDecision?.decision === "reject") {
    return ["finalize_run"];
  }

  if ((intent === "trade" || intent === "countertrade") && !hasCalled(steps, "create_trade_ticket")) {
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

function getLatestToolOutput<T>(
  steps: Array<Pick<StepResult<ToolSet>, "toolResults">>,
  toolName: string,
): T | undefined {
  return steps
    .flatMap((step) => step.toolResults)
    .filter((result) => result.toolName === toolName)
    .at(-1)?.output as T | undefined;
}
