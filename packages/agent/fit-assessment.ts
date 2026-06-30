import type { ExpressionFitAssessment } from "../core/schemas/index.ts";

export function enforceFitScoreInvariant(
  assessment: ExpressionFitAssessment,
): ExpressionFitAssessment {
  if (assessment.fitStatus === "validated" && assessment.fitScore < 0.7) {
    throw new Error(
      `Validated expression fit ${assessment.candidateId} requires fitScore >= 0.7; received ${assessment.fitScore}.`,
    );
  }

  if (assessment.fitStatus === "rejected" && assessment.fitScore >= 0.7) {
    throw new Error(
      `Rejected expression fit ${assessment.candidateId} requires fitScore < 0.7; received ${assessment.fitScore}.`,
    );
  }

  return assessment;
}
