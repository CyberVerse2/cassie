import { z } from "zod";
import { CassieActionStateSchema } from "../core/schemas/index.ts";

export const XPostGoldenEvalCaseSchema = z.object({
  id: z.string(),
  expectedActionStates: z.array(CassieActionStateSchema).min(1),
  requiredVenuesToCheck: z.array(z.string()).min(1),
  requiredReasoning: z.array(z.string()).min(1),
  forbiddenBehavior: z.array(z.string()).min(1),
});

export const XPostEvalOutcomeSchema = z.object({
  actionState: CassieActionStateSchema,
  publicSummary: z.string(),
  evidenceText: z.string().optional(),
});

export type XPostGoldenEvalCase = z.infer<typeof XPostGoldenEvalCaseSchema>;
export type XPostEvalOutcome = z.infer<typeof XPostEvalOutcomeSchema>;

export function evaluateXPostCaseOutcome(input: {
  evalCase: XPostGoldenEvalCase;
  outcome: XPostEvalOutcome;
}) {
  const evalCase = XPostGoldenEvalCaseSchema.parse(input.evalCase);
  const outcome = XPostEvalOutcomeSchema.parse(input.outcome);
  const text = normalizeText([outcome.publicSummary, outcome.evidenceText].filter(Boolean).join(" "));
  const failures: string[] = [];

  if (!evalCase.expectedActionStates.includes(outcome.actionState)) {
    failures.push(`action state ${outcome.actionState} is not in expected states: ${evalCase.expectedActionStates.join(", ")}`);
  }

  for (const venue of evalCase.requiredVenuesToCheck) {
    if (!matchesRequirement(text, venue)) {
      failures.push(`missing required venue check: ${venue}`);
    }
  }

  for (const reasoning of evalCase.requiredReasoning) {
    if (!matchesRequirement(text, reasoning)) {
      failures.push(`missing required reasoning: ${reasoning}`);
    }
  }

  for (const forbidden of evalCase.forbiddenBehavior) {
    if (matchesForbiddenBehavior(text, forbidden)) {
      failures.push(`matched forbidden behavior: ${forbidden}`);
    }
  }

  return {
    caseId: evalCase.id,
    passed: failures.length === 0,
    failures,
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_/.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesRequirement(text: string, requirement: string): boolean {
  return tokenAlternatives(requirement).every((alternatives) =>
    alternatives.some((alternative) => text.includes(alternative)),
  );
}

function matchesForbiddenBehavior(text: string, forbidden: string): boolean {
  const normalizedForbidden = normalizeText(forbidden);
  if (normalizedForbidden.includes("no possible trade") && text.includes("no possible trade")) {
    return true;
  }
  if (normalizedForbidden.includes("direct public stock trade") && text.includes("direct public stock")) {
    return true;
  }

  const tokens = tokenAlternatives(forbidden)
    .flatMap((alternatives) => alternatives)
    .filter((token) => token.length > 3);
  if (tokens.length === 0) return false;
  const matched = tokens.filter((token) => text.includes(token)).length;
  return matched / tokens.length >= 0.65;
}

function tokenAlternatives(value: string): string[][] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2)
    .map((token) => {
      if (token === "hyperliquid") return ["hyperliquid"];
      if (token === "pre") return ["pre", "prestock"];
      if (token === "stock") return ["stock", "prestock"];
      if (token === "polymarket") return ["polymarket", "prediction"];
      if (token === "private") return ["private", "pre ipo"];
      if (token === "odds") return ["odds", "probability", "price"];
      if (token === "invalidation") return ["invalidation", "invalidates", "block"];
      return [token];
    });
}
