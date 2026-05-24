import type {
  CassieStoreSnapshot,
  ModelCallUsageRecord,
} from "../packages/core/db/store.ts";
import type { RunStep } from "../packages/core/schemas/index.ts";
import {
  createTerminalTheme,
  indentWrap,
  normalizeStatus,
  statusTag,
  terminalTable,
  type TerminalTheme,
} from "./helpers/terminal-ui.ts";

type RecordValue = Record<string, unknown>;

export function formatRunTimeline(snapshot: CassieStoreSnapshot, runId: string): string {
  const theme = createTerminalTheme();
  const run = snapshot.controlRuns.find((candidate) => candidate.runId === runId);
  if (!run) {
    return `${theme.title("CASSIE RUN TIMELINE")}\n[missing] ${runId}`;
  }

  const lines = [
    theme.title("CASSIE RUN TIMELINE"),
    `${statusTag(run.status, theme)} ${theme.section(run.runId)} ${normalizeStatus(run.status)}`,
    `|-- ${theme.label("user")} ${run.userId}`,
    ...indentWrap({ text: `${theme.label("command")} ${run.userCommand}`, indent: "|-- ", theme }),
    ...indentWrap({
      text: `${theme.label("source")} ${run.sourcePost.authorHandle ?? "unknown"} ${run.sourcePost.url ?? run.sourcePost.postId ?? "local-post"}`,
      indent: "|-- ",
      theme,
    }),
    "",
    theme.section("TOOLS"),
  ];

  const steps = snapshot.runSteps
    .filter((step) => step.runId === runId)
    .sort(compareStarted);
  if (steps.length === 0) {
    lines.push("|-- none");
  } else {
    for (const step of steps) {
      lines.push(...formatRunStep(step, theme));
    }
  }

  const usage = snapshot.modelCallUsage
    .filter((record) => record.controlRunId === runId)
    .sort(compareCreated);
  lines.push("", theme.section("USAGE"));
  if (usage.length === 0) {
    lines.push("|-- none");
  } else {
    lines.push(...formatModelUsageTable(usage, theme));
    const totals = usage.reduce(
      (sum, record) => ({
        input: sum.input + (record.inputTokens ?? 0),
        output: sum.output + (record.outputTokens ?? 0),
        reasoning: sum.reasoning + (record.reasoningTokens ?? 0),
        cacheRead: sum.cacheRead + (record.cachedTokens ?? 0),
        total: sum.total + (record.totalTokens ?? 0),
      }),
      { input: 0, output: 0, reasoning: 0, cacheRead: 0, total: 0 },
    );
    lines.push(`|-- ${theme.ai("[tokens]")} total=${totals.total} input=${totals.input} output=${totals.output} reasoning=${totals.reasoning} cache=${totals.cacheRead}`);
  }

  return lines.join("\n");
}

function formatRunStep(step: RunStep, theme: TerminalTheme): string[] {
  const duration = durationText(step.startedAt, step.completedAt);
  const lines = [
    `|-- ${toolBadge(step, theme)} ${step.stepType} ${statusTag(step.status, theme)} ${duration}`,
    `|   |-- ${theme.label("model")} ${step.model ?? "none"}`,
  ];
  if (step.promptName) {
    lines.push(`|   |-- ${theme.label("prompt")} ${step.promptName}@${step.promptVersion ?? "unknown"}`);
  }
  if (step.thinkingTrace) {
    lines.push(...indentWrap({ text: `${theme.label("thinking")} ${step.thinkingTrace}`, indent: "|   |-- ", theme }));
  }
  const summary = summarizeStepOutput(step.output);
  if (summary) {
    lines.push(...indentWrap({ text: `${theme.label("output")} ${summary}`, indent: "|   |-- ", theme }));
  }
  if (step.error) {
    lines.push(...indentWrap({ text: `${theme.fail("error")} ${step.error}`, indent: "|   |-- ", theme }));
  }
  return lines;
}

function formatModelUsageTable(records: ModelCallUsageRecord[], theme: TerminalTheme): string[] {
  return terminalTable({
    head: ["model", "purpose", "status", "tokens", "in", "out", "reasoning", "cache"],
    rows: records.map((record) => [
      record.model,
      record.purpose,
      normalizeStatus(record.status),
      record.totalTokens,
      record.inputTokens,
      record.outputTokens,
      record.reasoningTokens,
      record.cachedTokens,
    ]),
    theme,
  }).map((line) => `|-- ${line}`);
}

function summarizeStepOutput(output: unknown): string | null {
  const record = objectOrNull(output);
  if (!record) return null;
  const fields = ["userIntent", "literalClaim", "opportunity", "decision", "approvalState", "responseType", "publicSummary"];
  const parts = fields
    .map((field) => {
      const value = record[field];
      return typeof value === "string" ? `${field}=${value}` : null;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : null;
}

function durationMs(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "unknown";
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown";
  return `${Math.max(0, end - start)}ms`;
}

function durationText(startedAt: string | null, completedAt: string | null): string {
  const raw = durationMs(startedAt, completedAt);
  if (raw === "unknown") return raw;
  const ms = Number(raw.replace("ms", ""));
  if (!Number.isFinite(ms)) return raw;
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function toolBadge(step: RunStep, theme: TerminalTheme): string {
  if (step.model) return theme.ai("[ai]");
  if (step.stepType === "risk") return theme.risk("[risk]");
  if (step.stepType === "ticket") return theme.ticket("[ticket]");
  return "[tool]";
}

function compareStarted(left: { startedAt: string }, right: { startedAt: string }): number {
  return left.startedAt.localeCompare(right.startedAt);
}

function compareCreated(left: { createdAt: string }, right: { createdAt: string }): number {
  return left.createdAt.localeCompare(right.createdAt);
}

function objectOrNull(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
