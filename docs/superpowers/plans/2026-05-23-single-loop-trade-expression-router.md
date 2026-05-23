# Single-Loop Trade Expression Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cassie's nested trade-expression loop with one supervisor tool loop that frames opportunities, generates expressions, searches venues, ranks candidates, runs risk, and creates tickets.

**Architecture:** The supervisor owns all AI/tool history. `packages/agent/tools/trade-expression.ts` becomes single-call structured helpers, while `packages/agent/supervisor/tools.ts` exposes first-class tools for opportunity framing, expression generation, venue search, ranking, risk, ticket creation, and finalization.

**Tech Stack:** TypeScript, AI SDK tools, Zod schemas, Vitest, existing Cassie store/run-step contracts.

---

### Task 1: Define Single-Loop Tool Contracts

**Files:**
- Modify: `packages/core/schemas/index.ts`
- Modify: `packages/prompts/index.ts`
- Modify: `packages/agent/tools/trade-expression.ts`
- Test: `tests/supervisor-agent.test.ts`

- [x] **Step 1:** Add a failing supervisor test that expects `frame_opportunity`, `generate_trade_expressions`, `search_venues`, and `rank_expressions`, and expects `plan_trade_expression` to be absent.
- [x] **Step 2:** Add `OpportunityFrameSchema` and prompt builders for opportunity framing and single-step expression generation.
- [x] **Step 3:** Replace the nested trade-expression loop with single-call helpers.
- [x] **Step 4:** Run `npm test -- tests/supervisor-agent.test.ts`.

### Task 2: Wire First-Class Supervisor Tools

**Files:**
- Modify: `packages/agent/supervisor/tools.ts`
- Modify: `packages/agent/supervisor/policy.ts`
- Modify: `packages/agent/supervisor/agent.ts`
- Test: `tests/supervisor-policy.test.ts`
- Test: `tests/supervisor-agent.test.ts`

- [x] **Step 1:** Update the supervisor policy tool surface to expose the single-loop tools.
- [x] **Step 2:** Add `frame_opportunity`, `generate_trade_expressions`, `search_venues`, `rank_expressions`, and keep `risk_check`, `create_trade_ticket`, `finalize_run`.
- [x] **Step 3:** Update supervisor instructions to describe the single-loop router.
- [x] **Step 4:** Run `npm test -- tests/supervisor-agent.test.ts tests/supervisor-policy.test.ts`.

### Task 3: Update Scenarios And Verify

**Files:**
- Modify: `tests/supervisor-scenarios.test.ts`
- Modify: `tests/trade-expression.test.ts`

- [x] **Step 1:** Remove expectations that call removed nested/legacy tools.
- [x] **Step 2:** Verify persisted steps show one supervisor stream.
- [x] **Step 3:** Run `npm run build` and `npm test`.
- [x] **Step 4:** Commit the implementation.
