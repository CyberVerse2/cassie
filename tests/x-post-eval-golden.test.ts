import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const GoldenEvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  postUrl: z.string().url(),
  authorHandle: z.string().regex(/^@/),
  postText: z.string().min(1),
  whyUseful: z.string().min(1),
  verificationStatus: z.literal("golden_verified"),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedActionStates: z.array(z.enum([
    "no_trade",
    "watchlist",
    "route_to_market",
    "long_perp",
    "short_perp",
    "buy_yes",
    "buy_no",
    "create_ticket",
    "block_trade",
  ])).min(1),
  requiredVenuesToCheck: z.array(z.enum([
    "hyperliquid_spot",
    "hyperliquid_perp",
    "hyperliquid_pre_stock",
    "polymarket",
    "public_equity",
    "listed_options",
    "crypto_spot",
    "private_market",
  ])).min(1),
  requiredReasoning: z.array(z.string().min(1)).min(1),
  expectedBehavior: z.array(z.string().min(1)).min(1),
  forbiddenBehavior: z.array(z.string().min(1)).min(1),
});

const EvalFixtureSchema = z.object({
  version: z.literal("cassie-x-post-eval-cases/v1"),
  source: z.string(),
  generatedAt: z.string(),
  verificationStatus: z.literal("golden_verified"),
  cases: z.array(GoldenEvalCaseSchema).min(1),
});

describe("X post golden eval fixture", () => {
  it("promotes verified cases into an actionable golden suite", () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/x-post-eval-cases.json", import.meta.url));
    const fixture = EvalFixtureSchema.parse(JSON.parse(readFileSync(fixturePath, "utf8")));

    expect(fixture.cases.map((entry) => entry.id)).toContain("private-company-spacex-no-clean-venue");
    expect(fixture.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "private-company-spacex-no-clean-venue",
          expectedActionStates: expect.arrayContaining(["watchlist", "route_to_market", "block_trade"]),
          requiredVenuesToCheck: expect.arrayContaining(["hyperliquid_pre_stock", "polymarket", "private_market"]),
          requiredReasoning: expect.arrayContaining(["venue availability", "valuation or odds", "risk and invalidation"]),
        }),
        expect.objectContaining({
          id: "coin-ticker-collision",
          expectedActionStates: expect.arrayContaining(["block_trade"]),
          requiredReasoning: expect.arrayContaining(["ticker collision"]),
        }),
      ]),
    );
  });
});
