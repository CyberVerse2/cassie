# Cassie Code Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize Cassie around production runtime boundaries without changing behavior.

**Architecture:** Keep `src/` as entrypoints. Move product orchestration to `packages/app`, supervisor/tool logic to `packages/agent`, prompt builders to `packages/prompts`, and venue discovery to `packages/markets`. Keep `packages/ai` limited to model-provider plumbing.

**Tech Stack:** TypeScript, ESM `.ts` imports, Vitest, Graphile Worker, Drizzle.

---

### Task 1: Move Domain Packages

**Files:**
- Move: `packages/workflows/*` -> `packages/app/*`
- Move: `packages/ai/agents/supervisor/*` -> `packages/agent/supervisor/*`
- Move: `packages/ai/tools/*` -> `packages/agent/tools/*`
- Move: `packages/ai/prompts/*` -> `packages/prompts/*`
- Move: `packages/market-data/*` -> `packages/markets/*`
- Create compatibility exports at the old package paths for existing local edits and docs.

- [x] Move files with `mkdir -p` and `mv`.
- [x] Add re-export shims at old paths.
- [x] Update imports in clean tracked files where safe.
- [x] Run `npm run build`.
- [x] Run focused tests for supervisor, market selection, prompts, control plane, and polling.
- [x] Commit only the organization changes.
