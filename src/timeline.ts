import type {
  CassieStoreSnapshot,
  ModelCallUsageRecord,
  ResearchContinuationDecisionRecord,
  ResearchEvidenceClaimRecord,
  ResearchGoalEvidenceLinkRecord,
  ResearchGoalResolutionRecord,
  ResearchQueryJobRecord,
  ResearchRunRecord,
  ResearchSearchResultRecord,
} from "../packages/db/store.ts";
import type { RunStep } from "../packages/core/schemas/index.ts";
import {
  createTerminalTheme,
  indentWrap,
  normalizeStatus,
  statusTag,
  terminalTable,
  type TerminalTheme,
} from "./terminal-ui.ts";

type RecordValue = Record<string, unknown>;

export function formatRunTimeline(snapshot: CassieStoreSnapshot, runId: string): string {
  const theme = createTerminalTheme();
  const run = snapshot.controlRuns.find((candidate) => candidate.runId === runId);
  if (!run) {
    return `${theme.title("CASSIE RUN TIMELINE")}\n[missing] ${runId}`;
  }

  const lines = [
    theme.title("CASSIE RUN TIMELINE"),
    `${statusBadge(run.status, theme)} ${theme.section(run.runId)} ${normalizeStatus(run.status)}`,
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

  const researchRuns = snapshot.researchRuns
    .filter((researchRun) => researchRun.controlRunId === runId)
    .sort(compareResearchStarted);
  lines.push("", theme.section("RESEARCH"));
  if (researchRuns.length === 0) {
    lines.push("|-- none");
  } else {
    for (const researchRun of researchRuns) {
      lines.push(...formatResearchRun(snapshot, researchRun, theme));
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
  lines.push(...indentWrap({ text: `${theme.label("thinking")} ${visibleThinkingForStep(step)}`, indent: "|   |-- ", theme }));
  const summary = summarizeStepOutput(step.output);
  if (summary) {
    lines.push(...indentWrap({ text: `${theme.label("output")} ${summary}`, indent: "|   |-- ", theme }));
  }
  if (step.error) {
    lines.push(...indentWrap({ text: `${theme.fail("error")} ${step.error}`, indent: "|   |-- ", theme }));
  }
  return lines;
}

function formatResearchRun(snapshot: CassieStoreSnapshot, researchRun: ResearchRunRecord, theme: TerminalTheme): string[] {
  const plan = objectOrNull(researchRun.queryPlan);
  const mode = stringField(plan, "mode") ?? "unknown";
  const lines = [
    `|-- ${theme.ai("[research]")} ${researchRun.researchRunId} ${statusTag(researchRun.status, theme)} ${researchRun.angle} ${mode} ${durationText(researchRun.startedAt, researchRun.completedAt)}`,
    ...indentWrap({
      text: `${theme.label("thinking")} Plan goals, execute auditable query jobs that emit evidence ledgers, resolve goals, and decide whether to stop or continue.`,
      indent: "|   |-- ",
      theme,
    }),
  ];
  const normalizedClaim = stringField(plan, "normalizedClaim");
  if (normalizedClaim) {
    lines.push(...indentWrap({ text: `${theme.label("claim")} ${normalizedClaim}`, indent: "|   |-- ", theme }));
  }

  const goals = arrayField(plan, "goals");
  if (goals.length > 0) {
    lines.push(`|   |-- ${theme.label("goals")}`);
    for (const goal of goals.slice(0, 12)) {
      const record = objectOrNull(goal);
      lines.push(...indentWrap({
        text: `${stringField(record, "id") ?? "unknown"} ${stringField(record, "kind") ?? "unknown"} ${stringField(record, "question") ?? ""}`,
        indent: "|   |   |-- ",
        theme,
      }));
    }
  }

  const jobs = snapshot.researchQueryJobs
    .filter((job) => job.researchRunId === researchRun.researchRunId)
    .sort(compareQueryJobs);
  const waves = uniqueNumbers(jobs.map((job) => job.wave));
  if (waves.length === 0) {
    lines.push("|   |-- waves none");
    return lines;
  }

  for (const wave of waves) {
    lines.push(`|   |-- ${theme.web(`[wave ${wave}]`)}`);
    const waveJobs = jobs.filter((job) => job.wave === wave);
    for (const job of waveJobs) {
      lines.push(...formatQueryJob(snapshot, researchRun.researchRunId, job, theme));
    }
    for (const resolution of snapshot.researchGoalResolutions
      .filter((item) => item.researchRunId === researchRun.researchRunId && item.wave === wave)
      .sort(compareGoalResolution)) {
      lines.push(formatGoalResolution(resolution, theme));
    }
    for (const decision of snapshot.researchContinuationDecisions
      .filter((item) => item.researchRunId === researchRun.researchRunId && item.wave === wave)
      .sort(compareCreated)) {
      lines.push(formatContinuationDecision(decision, theme));
    }
  }

  if (researchRun.error) {
    lines.push(...indentWrap({ text: `${theme.fail("error")} ${researchRun.error}`, indent: "|   |-- ", theme }));
  }
  return lines;
}

function formatQueryJob(
  snapshot: CassieStoreSnapshot,
  researchRunId: string,
  job: ResearchQueryJobRecord,
  theme: TerminalTheme,
): string[] {
  const duration = durationText(job.startedAt, job.completedAt);
  const laneBadge = job.lane === "x" ? theme.x("[x]") : theme.web("[web]");
  const lines = [
    `|   |   |-- ${laneBadge} ${job.querySpecId} ${job.lane}/${job.provider} ${statusTag(job.status, theme)} ${duration} ${job.mustExecuteAtomically ? "atomic" : "bundled"} p=${job.priority}`,
    `|   |   |   |-- ${theme.label("tool")} ${job.lane === "web" ? "Gemini web query job" : "Grok X query job"}`,
    ...indentWrap({ text: `${theme.label("thinking")} ${job.rationale}`, indent: "|   |   |   |-- ", theme }),
    ...indentWrap({ text: `${theme.label("query")} ${job.query}`, indent: "|   |   |   |-- ", theme }),
  ];
  if (job.error) {
    lines.push(...indentWrap({ text: `${theme.fail("error")} ${job.error}`, indent: "|   |   |   |-- ", theme }));
  }

  const results = snapshot.researchSearchResults
    .filter((result) => result.researchRunId === researchRunId && result.queryJobId === job.id)
    .sort(compareSearchResults);
  for (const result of results.slice(0, 6)) {
    lines.push(...formatSearchResult(result, theme));
  }

  const claims = snapshot.researchEvidenceClaims
    .filter((claim) => claim.researchRunId === researchRunId && claim.queryJobId === job.id)
    .sort(compareEvidenceClaims);
  for (const claim of claims.slice(0, 8)) {
    lines.push(...formatEvidenceClaim(claim, theme));
    for (const link of snapshot.researchGoalEvidenceLinks
      .filter((item) => item.researchRunId === researchRunId && item.evidenceClaimId === claim.id)
      .sort(compareGoalLinks)) {
      lines.push(...formatGoalEvidenceLink(link, theme));
    }
  }

  return lines;
}

function formatSearchResult(result: ResearchSearchResultRecord, theme: TerminalTheme): string[] {
  const title = result.title ?? result.url ?? result.id;
  const url = result.url ? ` ${result.url}` : "";
  return indentWrap({ text: `${theme.label("result")} ${result.id} ${result.sourceType} ${title}${url}`, indent: "|   |   |   |-- ", theme });
}

function formatEvidenceClaim(claim: ResearchEvidenceClaimRecord, theme: TerminalTheme): string[] {
  return indentWrap({
    text: `${theme.label("claim")} ${claim.id} ${claim.reliability}/${claim.directness} ${claim.claimText}`,
    indent: "|   |   |   |-- ",
    theme,
  });
}

function formatGoalEvidenceLink(link: ResearchGoalEvidenceLinkRecord, theme: TerminalTheme): string[] {
  return indentWrap({
    text: `${theme.label("link")} ${link.goalId} ${link.stance} strength=${link.strength}: ${link.reason}`,
    indent: "|   |   |   |   |-- ",
    theme,
  });
}

function formatGoalResolution(resolution: ResearchGoalResolutionRecord, theme: TerminalTheme): string {
  return `|   |   |-- ${theme.ai("[goal]")} ${resolution.goalId} ${statusTag(resolution.status, theme)} c=${resolution.confidence}: ${resolution.summary}`;
}

function formatContinuationDecision(decision: ResearchContinuationDecisionRecord, theme: TerminalTheme): string {
  const blocked = decision.blockedActions.length > 0 ? ` blocked=${decision.blockedActions.join(",")}` : "";
  return `|   |   |-- ${theme.risk("[controller]")} ${decision.action}: ${decision.reason}${blocked}`;
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

function visibleThinkingForStep(step: RunStep): string {
  switch (step.stepType) {
    case "intake":
      return "Persist the incoming mention as a durable control-plane run before doing agent work.";
    case "intent":
      return "Classify command and source into a bounded Cassie intent.";
    case "signal":
      return "Classify the post signal, tradability, lead quality, and research angles.";
    case "thesis":
      return "Extract the explicit or implied thesis that research should test.";
    case "inverse_thesis":
      return "Build the strongest opposing thesis for countertrade or fade analysis.";
    case "research":
      return "Run goal-first research with query jobs that emit evidence ledgers and goal resolution.";
    case "critique":
      return "Use the research report to identify the strongest objections and weaknesses.";
    case "trade_expression":
      return "Estimate the cleanest venue-aware expression, including fair value when valuation matters.";
    case "market_candidates":
      return "Fetch real market candidates from configured venues.";
    case "market_assessment":
      return "Assess whether a prediction market directly expresses the thesis.";
    case "market_quote":
      return "Refresh prediction-market outcome pricing before selection or ticketing.";
    case "market_selection":
      return "Select the best real market expression without inventing instruments.";
    case "risk":
      return "Evaluate deterministic risk limits against settings and account state.";
    case "ticket":
      return "Create a ticket only after research, market selection, and risk checks allow it.";
    case "final":
      return "Persist the user-facing final result and run status.";
  }
}

function summarizeStepOutput(output: unknown): string | null {
  const record = objectOrNull(output);
  if (!record) return null;
  const fields = ["intent", "signalType", "claim", "stance", "decision", "approvalState", "responseType", "publicSummary"];
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

function statusWord(status: string): string {
  if (status === "succeeded") return "ok";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "queued" || status === "pending") return "pending";
  if (status === "skipped") return "skipped";
  return status;
}

function statusBadge(status: string, theme: TerminalTheme): string {
  return statusTag(status, theme);
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

function compareResearchStarted(left: ResearchRunRecord, right: ResearchRunRecord): number {
  return left.startedAt.localeCompare(right.startedAt);
}

function compareCreated(left: { createdAt: string }, right: { createdAt: string }): number {
  return left.createdAt.localeCompare(right.createdAt);
}

function compareQueryJobs(left: ResearchQueryJobRecord, right: ResearchQueryJobRecord): number {
  return left.wave - right.wave || left.startedAt?.localeCompare(right.startedAt ?? "") || left.querySpecId.localeCompare(right.querySpecId);
}

function compareSearchResults(left: ResearchSearchResultRecord, right: ResearchSearchResultRecord): number {
  return (left.rank ?? 9999) - (right.rank ?? 9999) || left.id.localeCompare(right.id);
}

function compareEvidenceClaims(left: ResearchEvidenceClaimRecord, right: ResearchEvidenceClaimRecord): number {
  return left.id.localeCompare(right.id);
}

function compareGoalLinks(left: ResearchGoalEvidenceLinkRecord, right: ResearchGoalEvidenceLinkRecord): number {
  return left.id.localeCompare(right.id);
}

function compareGoalResolution(left: ResearchGoalResolutionRecord, right: ResearchGoalResolutionRecord): number {
  return left.goalId.localeCompare(right.goalId);
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function objectOrNull(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function stringField(record: RecordValue | null, field: string): string | null {
  const value = record?.[field];
  return typeof value === "string" ? value : null;
}

function arrayField(record: RecordValue | null, field: string): unknown[] {
  const value = record?.[field];
  return Array.isArray(value) ? value : [];
}
