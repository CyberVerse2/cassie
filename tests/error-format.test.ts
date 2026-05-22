import { describe, expect, it } from "vitest";
import { formatErrorForLog } from "../packages/core/error-format.ts";

describe("AI error formatting", () => {
  it("includes AI SDK structured-output details and cause chain", () => {
    const cause = new Error("expected number, received string");
    cause.name = "AI_TypeValidationError";
    const error = Object.assign(new Error("No object generated: response did not match schema."), {
      name: "AI_NoObjectGeneratedError",
      finishReason: "stop",
      text: "{\"confidence\":\"high\"}",
      usage: { totalTokens: 123 },
      cause,
    });

    expect(formatErrorForLog(error)).toContain("AI_NoObjectGeneratedError");
    expect(formatErrorForLog(error)).toContain("finishReason=stop");
    expect(formatErrorForLog(error)).toContain("totalTokens=123");
    expect(formatErrorForLog(error)).toContain("textPreview");
    expect(formatErrorForLog(error)).toContain("AI_TypeValidationError");
    expect(formatErrorForLog(error)).toContain("expected number");
  });
});
