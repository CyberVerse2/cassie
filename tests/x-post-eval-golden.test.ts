import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const ActionStateSchema = z.enum([
  "no_trade",
  "needs_market_check",
  "insufficient_evidence",
  "trade_candidate",
  "route_to_market",
  "long_perp",
  "short_perp",
  "buy_yes",
  "buy_no",
  "create_ticket",
  "block_trade",
]);

const VenueCheckSchema = z.enum([
  "hyperliquid_spot",
  "hyperliquid_perp",
  "hyperliquid_pre_stock",
  "polymarket",
]);

const CandidateEvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  postUrl: z.string().url(),
  authorHandle: z.string().regex(/^@/),
  postText: z.string().min(1),
  whyUseful: z.string().min(1),
  verificationStatus: z.enum(["grok_candidate_unverified", "golden_verified"]),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  candidateActionStates: z.array(ActionStateSchema).min(1),
  candidateVenuesToCheck: z.array(VenueCheckSchema).min(1),
  candidateReasoningChecks: z.array(z.string().min(1)).min(1),
  expectedBehavior: z.array(z.string().min(1)).min(1),
  forbiddenBehavior: z.array(z.string().min(1)).min(1),
}).superRefine((entry, ctx) => {
  if (entry.verificationStatus === "golden_verified" && !entry.verifiedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["verifiedAt"],
      message: "golden cases must include a verification date",
    });
  }
});

const EvalFixtureSchema = z.object({
  version: z.literal("cassie-x-post-eval-cases/v1"),
  source: z.string(),
  generatedAt: z.string(),
  verificationStatus: z.enum(["grok_candidate_unverified", "golden_verified"]),
  cases: z.array(CandidateEvalCaseSchema).min(1),
});

describe("X post eval fixture", () => {
  it("keeps Grok candidates separate from verified golden cases while locking structural eval targets", () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/x-post-eval-cases.json", import.meta.url));
    const fixture = EvalFixtureSchema.parse(JSON.parse(readFileSync(fixturePath, "utf8")));

    expect(fixture.verificationStatus).toBe("grok_candidate_unverified");
    expect(fixture.cases.every((entry) => entry.verificationStatus === "grok_candidate_unverified")).toBe(true);
    expect(fixture.cases.map((entry) => entry.id)).toContain("private-company-spacex-no-clean-venue");
    expect(fixture.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "private-company-spacex-no-clean-venue",
          candidateActionStates: expect.arrayContaining(["needs_market_check", "route_to_market", "block_trade"]),
          candidateVenuesToCheck: expect.arrayContaining(["hyperliquid_pre_stock", "polymarket"]),
          candidateReasoningChecks: expect.arrayContaining(["venue availability", "valuation or odds", "risk and invalidation"]),
        }),
        expect.objectContaining({
          id: "coin-ticker-collision",
          candidateActionStates: expect.arrayContaining(["block_trade"]),
          candidateReasoningChecks: expect.arrayContaining(["ticker collision"]),
        }),
      ]),
    );
  });
});
