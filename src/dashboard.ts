import type { CassieStoreSnapshot, ModelCallUsageRecord } from "../packages/core/db/store.ts";
import type { ControlRun, ExecutionJob, RunStep, TradeTicket } from "../packages/core/schemas/index.ts";

export interface DashboardOptions {
  query?: string | null;
  status?: string | null;
  model?: string | null;
  selectedRunId?: string | null;
  refreshSeconds?: number | null;
}

interface DashboardFilters {
  query: string;
  status: string;
  model: string;
  selectedRunId: string;
  refreshSeconds: number | null;
}

interface TimelineItem {
  at: string;
  type: string;
  title: string;
  detail: string;
  status?: string;
  href?: string;
}

interface TokenTotals {
  input: number;
  output: number;
  reasoning: number;
  cached: number;
  total: number;
  costUsd: number;
  calls: number;
  failedCalls: number;
}

interface ThinkingTraceItem {
  at: string;
  source: "step" | "model.call";
  title: string;
  detail: string;
  status: string;
  trace: string;
}

interface FailureItem {
  at: string;
  runId: string;
  source: string;
  model: string | null;
  promptName: string | null;
  tokens: number;
  error: string;
}

interface GroupedFailure {
  signature: string;
  count: number;
  tokens: number;
  latestAt: string;
  latestRunId: string;
  sample: string;
}

interface SpendGroup {
  key: string;
  subtitle: string;
  totals: TokenTotals;
}

interface WaterfallItem {
  at: string;
  label: string;
  detail: string;
  status: string;
  durationMs: number | null;
  tokens: number;
  error: string | null;
}

export function renderDashboard(state: CassieStoreSnapshot, options: DashboardOptions = {}): string {
  const filters = normalizeDashboardOptions(options);
  const tokenTotals = summarizeTokenUsage(state.modelCallUsage);
  const pendingTickets = state.tradeTickets.filter((ticket) => ticket.approvalState === "pending");
  const sortedRuns = state.controlRuns.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const filteredRuns = filterRuns(state, sortedRuns, filters);
  const selectedRun = chooseSelectedRun(sortedRuns, filteredRuns, filters.selectedRunId);
  const sortedJobs = state.executionJobs.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const timeline = buildTimeline(state).slice(0, 80);
  const statuses = uniqueSorted(sortedRuns.map((run) => run.status));
  const models = uniqueSorted(state.modelCallUsage.map((record) => record.model));
  const failures = collectFailures(state);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${filters.refreshSeconds ? `<meta http-equiv="refresh" content="${filters.refreshSeconds}">` : ""}
  <title>Cassie Admin</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1115;
      --panel: #171a20;
      --panel-2: #1d2129;
      --panel-3: #141820;
      --line: #303641;
      --line-soft: #242933;
      --text: #f5f3ec;
      --muted: #aab2c0;
      --quiet: #747e8f;
      --green: #73d18f;
      --red: #ff8a8a;
      --yellow: #f0c36d;
      --blue: #84b8ff;
      --violet: #c7a8ff;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    a { color: inherit; text-decoration: none; }
    header {
      border-bottom: 1px solid var(--line);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(15, 17, 21, 0.96);
      backdrop-filter: blur(10px);
    }
    h1, h2, h3 { margin: 0; font-weight: 650; letter-spacing: 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 15px; }
    h3 { font-size: 14px; }
    main { display: grid; gap: 16px; padding: 16px; }
    section {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 14px;
      min-width: 0;
    }
    button, .button {
      border: 1px solid var(--line);
      background: #222733;
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
      font: inherit;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    button:hover, .button:hover { border-color: var(--muted); }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      background: #11141a;
      color: var(--text);
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
    }
    label {
      display: grid;
      gap: 5px;
      color: var(--quiet);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border-bottom: 1px solid var(--line-soft);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      color: var(--quiet);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    td { color: var(--muted); }
    td strong { color: var(--text); }
    pre {
      margin: 8px 0 0;
      max-height: 280px;
      overflow: auto;
      white-space: pre-wrap;
      color: var(--muted);
      background: #11141a;
      border: 1px solid var(--line-soft);
      border-radius: 6px;
      padding: 10px;
    }
    summary { cursor: pointer; }
    .subhead { color: var(--muted); margin-top: 4px; }
    .muted { color: var(--muted); }
    .quiet { color: var(--quiet); }
    .topline {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 12px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric, .attention-card {
      border: 1px solid var(--line);
      background: var(--panel-2);
      border-radius: 8px;
      padding: 12px;
      min-width: 0;
    }
    .metric-label {
      color: var(--quiet);
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 650;
    }
    .metric-value {
      margin-top: 5px;
      font-size: 23px;
      line-height: 1.1;
      font-weight: 700;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .metric-note { margin-top: 5px; color: var(--muted); font-size: 12px; }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
      gap: 16px;
      align-items: start;
    }
    .stack { display: grid; gap: 16px; min-width: 0; }
    .row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line-soft);
      padding: 11px 0;
    }
    .row > div:first-child { min-width: 0; }
    .row:last-child { border-bottom: 0; padding-bottom: 0; }
    .status {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      white-space: nowrap;
      color: var(--muted);
      background: #151922;
      font-size: 12px;
    }
    .status-succeeded, .status-approved, .status-not_required { color: var(--green); }
    .status-failed, .status-rejected, .status-cancelled { color: var(--red); }
    .status-running, .status-awaiting_approval, .status-pending { color: var(--yellow); }
    .status-queued { color: var(--blue); }
    .timeline { position: relative; display: grid; gap: 0; }
    .timeline::before {
      content: "";
      position: absolute;
      left: 91px;
      top: 6px;
      bottom: 6px;
      width: 1px;
      background: var(--line);
    }
    .event {
      display: grid;
      grid-template-columns: 76px 1fr;
      gap: 28px;
      position: relative;
      padding: 11px 0;
      border-bottom: 1px solid var(--line-soft);
    }
    .event:last-child { border-bottom: 0; }
    .event::after {
      content: "";
      position: absolute;
      left: 87px;
      top: 17px;
      width: 9px;
      height: 9px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .event-time { color: var(--quiet); font-size: 12px; }
    .event-title { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .event-detail { color: var(--muted); margin-top: 3px; }
    .control-form {
      display: grid;
      grid-template-columns: minmax(220px, 1.4fr) repeat(3, minmax(130px, 0.8fr)) auto;
      gap: 10px;
      align-items: end;
    }
    .filter-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .filter-tabs a[aria-current="page"] { border-color: var(--blue); color: var(--blue); }
    .attention-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .attention-card strong {
      display: block;
      font-size: 13px;
      margin-bottom: 5px;
    }
    .attention-card div { color: var(--muted); overflow-wrap: anywhere; }
    .run-shell {
      display: grid;
      grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.2fr);
      gap: 12px;
      align-items: start;
    }
    .run-rail {
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      overflow: hidden;
      background: var(--panel-3);
    }
    .run-row {
      display: grid;
      gap: 6px;
      padding: 11px;
      border-bottom: 1px solid var(--line-soft);
    }
    .run-row:last-child { border-bottom: 0; }
    .run-row[aria-current="page"] {
      background: #202633;
      outline: 1px solid var(--blue);
      outline-offset: -1px;
    }
    .run-row-title {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }
    .run-row-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--quiet); font-size: 12px; }
    .run-detail {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 14px;
      min-width: 0;
    }
    .run-detail-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .run-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .token-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-bottom: 12px;
    }
    .token-grid .metric-value { font-size: 20px; line-height: 1.15; }
    .mini-panel {
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 12px;
      min-width: 0;
      overflow: hidden;
    }
    .mini-panel h3 { margin-bottom: 8px; }
    .wide-panel { grid-column: 1 / -1; }
    .waterfall { display: grid; gap: 9px; }
    .waterfall-row {
      display: grid;
      grid-template-columns: minmax(120px, 0.65fr) minmax(160px, 1fr) minmax(90px, 0.35fr);
      gap: 10px;
      align-items: center;
      border-bottom: 1px solid var(--line-soft);
      padding-bottom: 9px;
    }
    .waterfall-row:last-child { border-bottom: 0; padding-bottom: 0; }
    .bar-track {
      height: 8px;
      border-radius: 999px;
      background: #101319;
      overflow: hidden;
      border: 1px solid var(--line-soft);
    }
    .bar-fill {
      height: 100%;
      width: var(--bar-width);
      min-width: 4px;
      background: var(--blue);
    }
    .status-failed + .bar-track .bar-fill, .bar-fill.failed { background: var(--red); }
    .thinking-trace {
      border-top: 1px solid var(--line-soft);
      padding: 10px 0;
    }
    .thinking-trace:first-of-type {
      border-top: 0;
      padding-top: 0;
    }
    .trace-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 5px;
    }
    .trace-text, .step-error {
      color: var(--muted);
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: pre-wrap;
      overflow: auto;
    }
    .trace-text { max-height: 11rem; }
    .step-error { margin-top: 6px; max-height: 9.5rem; }
    .empty { color: var(--muted); padding: 12px 0 0; }
    .truncate {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .sr-status {
      position: fixed;
      right: 16px;
      bottom: 16px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 6px;
      padding: 8px 10px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 160ms ease-out;
    }
    .sr-status.visible { opacity: 1; }
    @media (max-width: 1180px) {
      .attention-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .run-shell { grid-template-columns: 1fr; }
    }
    @media (max-width: 980px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .layout { grid-template-columns: 1fr; }
      .control-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      header { align-items: flex-start; flex-direction: column; }
      main { padding: 12px; }
      section { padding: 13px; }
      .grid, .two-col, .token-grid, .attention-grid, .control-form { grid-template-columns: 1fr; }
      .metric-value { font-size: 21px; }
      .timeline::before { left: 71px; }
      .event { grid-template-columns: 56px 1fr; gap: 28px; }
      .event::after { left: 67px; }
      .run-detail-head { display: grid; }
      .waterfall-row { grid-template-columns: 1fr; }
      th:nth-child(4), td:nth-child(4) { display: none; }
    }
  </style>
  <script src="/dashboard.js" defer></script>
</head>
<body>
  <header>
    <div>
      <h1>Cassie Admin</h1>
      <div class="subhead">Control-room view for runs, jobs, token spend, failures, reasoning, and execution state.</div>
    </div>
    <div class="actions">
      <span class="status">Updated ${formatDateTime(new Date().toISOString())}</span>
      <a class="button" href="/dashboard">Refresh</a>
    </div>
  </header>
  <main>
    <section aria-labelledby="overview-title">
      <div class="topline">
        <div>
          <h2 id="overview-title">Overview</h2>
          <div class="subhead">${state.controlRuns.length} runs / ${state.executionJobs.length} jobs / ${state.tradeTickets.length} tickets / ${state.auditEvents.length} audit events</div>
        </div>
      </div>
      <div class="grid">
        ${metric("Runs", String(state.controlRuns.length), statusSummary(state.controlRuns.map((run) => run.status)))}
        ${metric("Execution Jobs", String(state.executionJobs.length), statusSummary(state.executionJobs.map((job) => job.status)))}
        ${metric("Token Spend", `${formatNumber(tokenTotals.total)} tokens`, `${formatUsd(tokenTotals.costUsd)} / ${tokenTotals.calls} model calls`)}
        ${metric("Approvals", String(pendingTickets.length), `${state.tradeTickets.length} total tickets`)}
      </div>
    </section>
    ${renderControls(filters, statuses, models)}
    ${renderAttention(state, sortedRuns, failures)}
    <div class="layout">
      <div class="stack">
        ${renderRunExplorer(state, filteredRuns, selectedRun, filters)}
        <section aria-labelledby="jobs-title">
          <div class="topline">
            <div>
              <h2 id="jobs-title">Execution Jobs</h2>
              <div class="subhead">Every execution job with ticket, status, result, and failure context.</div>
            </div>
          </div>
          ${renderJobsTable(sortedJobs, state.tradeTickets)}
        </section>
      </div>
      <div class="stack">
        <section aria-labelledby="tokens-title">
          <div class="topline">
            <div>
              <h2 id="tokens-title">Token Spend</h2>
              <div class="subhead">Tracked input, output, reasoning, cache, estimated cost, and failures.</div>
            </div>
          </div>
          ${renderTokenBreakdown(tokenTotals)}
          ${renderSpendBreakdowns(state.modelCallUsage)}
          ${renderUsageTable(state.modelCallUsage)}
        </section>
        <section aria-labelledby="failures-title">
          <div class="topline">
            <div>
              <h2 id="failures-title">Failure Triage</h2>
              <div class="subhead">Repeated error classes, latest run, and token spend lost to failures.</div>
            </div>
          </div>
          ${renderFailureTriage(failures)}
        </section>
        <section aria-labelledby="tickets-title">
          <div class="topline">
            <div>
              <h2 id="tickets-title">Pending Tickets</h2>
              <div class="subhead">Approval queue for tickets that need a human decision.</div>
            </div>
          </div>
          ${renderPendingTickets(pendingTickets)}
        </section>
        <section aria-labelledby="timeline-title">
          <div class="topline">
            <div>
              <h2 id="timeline-title">Timeline</h2>
              <div class="subhead">Latest ${timeline.length} run, tool, model, job, ticket, and audit events.</div>
            </div>
          </div>
          ${renderTimeline(timeline)}
        </section>
      </div>
    </div>
    <div class="sr-status" role="status" aria-live="polite"></div>
  </main>
</body>
</html>`;
}

export function renderDashboardScript(): string {
  return `(() => {
  const toast = document.querySelector(".sr-status");
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 1600);
  }
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-copy-value]");
    if (!target) return;
    const value = target.getAttribute("data-copy-value") || "";
    try {
      await navigator.clipboard.writeText(value);
      showToast(target.getAttribute("data-copy-label") || "Copied");
    } catch {
      showToast("Copy failed");
    }
  });
})();`;
}

function renderControls(filters: DashboardFilters, statuses: string[], models: string[]): string {
  const statusTabs = ["all", ...statuses].map((status) => {
    const href = dashboardHref({ ...filters, status: status === "all" ? "" : status, selectedRunId: "" });
    const active = (filters.status || "all") === status;
    return `<a class="status" href="${attributeValue(href)}" ${active ? `aria-current="page"` : ""}>${escapeHtml(status)}</a>`;
  }).join("");

  return `<section aria-labelledby="controls-title">
    <div class="topline">
      <div>
        <h2 id="controls-title">Run Search</h2>
        <div class="subhead">Filter by status, model, run ID, prompt, source, or error text.</div>
      </div>
    </div>
    <form class="control-form" method="get" action="/dashboard">
      <label>Search<input name="q" value="${attributeValue(filters.query)}" placeholder="run, prompt, model, error, source"></label>
      <label>Status<select name="status">${option("", "All statuses", filters.status)}${statuses.map((status) => option(status, status, filters.status)).join("")}</select></label>
      <label>Model<select name="model">${option("", "All models", filters.model)}${models.map((model) => option(model, model, filters.model)).join("")}</select></label>
      <label>Auto-refresh<select name="refresh">${option("", "Off", String(filters.refreshSeconds ?? ""))}${[5, 10, 30, 60].map((seconds) => option(String(seconds), `${seconds}s`, String(filters.refreshSeconds ?? ""))).join("")}</select></label>
      ${filters.selectedRunId ? `<input type="hidden" name="run" value="${attributeValue(filters.selectedRunId)}">` : ""}
      <button type="submit">Apply</button>
    </form>
    <div class="filter-tabs">${statusTabs}</div>
  </section>`;
}

function renderAttention(state: CassieStoreSnapshot, runs: ControlRun[], failures: FailureItem[]): string {
  const latestFailure = failures.slice().sort((left, right) => right.at.localeCompare(left.at))[0];
  const running = runs.filter((run) => run.status === "running");
  const queued = runs.filter((run) => run.status === "queued");
  const succeeded = runs.find((run) => run.status === "succeeded");
  const expensive = runs
    .map((run) => ({ run, totals: summarizeTokenUsage(state.modelCallUsage.filter((record) => record.controlRunId === run.runId)) }))
    .sort((left, right) => right.totals.total - left.totals.total)[0];

  return `<section aria-labelledby="attention-title">
    <div class="topline">
      <div>
        <h2 id="attention-title">Attention Needed</h2>
        <div class="subhead">Fast triage for what changed, what is stuck, and what is costing tokens.</div>
      </div>
    </div>
    <div class="grid attention-grid">
      ${attentionCard("Latest failure", latestFailure ? `<a href="${attributeValue(dashboardHref({ selectedRunId: latestFailure.runId }))}">${escapeHtml(latestFailure.source)}</a><br>${escapeHtml(compactError(latestFailure.error))}` : "No failures recorded.")}
      ${attentionCard("Running now", `${running.length} active${running[0] ? `<br><a href="${attributeValue(dashboardHref({ selectedRunId: running[0].runId }))}">${escapeHtml(running[0].runId)}</a>` : ""}`)}
      ${attentionCard("Queued", `${queued.length} waiting${queued[0] ? `<br><a href="${attributeValue(dashboardHref({ selectedRunId: queued[0].runId }))}">${escapeHtml(queued[0].runId)}</a>` : ""}`)}
      ${attentionCard("Most expensive run", expensive ? `<a href="${attributeValue(dashboardHref({ selectedRunId: expensive.run.runId }))}">${formatNumber(expensive.totals.total)} tokens</a><br>${escapeHtml(expensive.run.status)}` : "No runs recorded.")}
      ${attentionCard("Last successful run", succeeded ? `<a href="${attributeValue(dashboardHref({ selectedRunId: succeeded.runId }))}">${escapeHtml(formatDateTime(succeeded.updatedAt))}</a><br>${escapeHtml(succeeded.runId)}` : "No successful runs yet.")}
    </div>
  </section>`;
}

function attentionCard(title: string, body: string): string {
  return `<div class="attention-card"><strong>${escapeHtml(title)}</strong><div>${body}</div></div>`;
}

function renderRunExplorer(
  state: CassieStoreSnapshot,
  runs: ControlRun[],
  selectedRun: ControlRun | null,
  filters: DashboardFilters,
): string {
  return `<section aria-labelledby="runs-title">
    <div class="topline">
      <div>
        <h2 id="runs-title">Runs</h2>
        <div class="subhead">${runs.length} matching runs. Select one for steps, model calls, failures, reasoning summaries, and JSON export.</div>
      </div>
    </div>
    <div class="run-shell">
      ${renderRunRail(state, runs, selectedRun, filters)}
      ${selectedRun ? renderRunDetail(state, selectedRun) : `<div class="run-detail"><div class="empty">No run matches the current filters.</div></div>`}
    </div>
  </section>`;
}

function renderRunRail(
  state: CassieStoreSnapshot,
  runs: ControlRun[],
  selectedRun: ControlRun | null,
  filters: DashboardFilters,
): string {
  if (runs.length === 0) {
    return `<div class="run-rail"><div class="empty">No runs match these filters.</div></div>`;
  }

  return `<div class="run-rail">
    ${runs.slice(0, 80).map((run) => {
      const totals = summarizeTokenUsage(state.modelCallUsage.filter((record) => record.controlRunId === run.runId));
      const steps = state.runSteps.filter((step) => step.runId === run.runId);
      const href = dashboardHref({ ...filters, selectedRunId: run.runId });
      return `<a class="run-row" data-run-row="${attributeValue(run.runId)}" data-run-status="${attributeValue(run.status)}" href="${attributeValue(href)}" ${selectedRun?.runId === run.runId ? `aria-current="page"` : ""}>
        <div class="run-row-title">
          <strong>${escapeHtml(run.userCommand)}</strong>
          ${statusBadge(run.status)}
        </div>
        <div class="run-row-meta">
          <span>${formatDateTime(run.createdAt)}</span>
          <span>${formatNumber(totals.total)} tokens</span>
          <span>${steps.length} steps</span>
        </div>
        ${run.error ? `<div class="muted truncate">${escapeHtml(compactError(run.error))}</div>` : ""}
      </a>`;
    }).join("")}
  </div>`;
}

function renderRunDetail(state: CassieStoreSnapshot, run: ControlRun): string {
  const context = runContext(state, run);
  const totals = summarizeTokenUsage(context.usage);
  const summary = resultSummary(run.result);
  const thinkingTraces = buildThinkingTraces(context.steps, context.usage);

  return `<article class="run-detail" id="run-${attributeValue(run.runId)}">
    <div class="run-detail-head">
      <div>
        <h3>${escapeHtml(run.userCommand)}</h3>
        <div class="run-meta">
          ${statusBadge(run.status)}
          <span class="status">${formatDateTime(run.createdAt)}</span>
          <span class="status">${formatNumber(totals.total)} tokens</span>
          <span class="status">${context.steps.length} steps</span>
          <span class="status">${context.tickets.length} tickets</span>
        </div>
      </div>
      <div class="actions">
        <button type="button" data-copy-value="${attributeValue(run.runId)}" data-copy-label="Run ID copied">Copy run ID</button>
        ${run.error ? `<button type="button" data-copy-value="${attributeValue(run.error)}" data-copy-label="Error copied">Copy error</button>` : ""}
        ${run.sourcePost.url ? `<a class="button" href="${attributeValue(run.sourcePost.url)}">Source</a>` : ""}
        <a class="button" href="/dashboard/runs/${attributeValue(run.runId)}.json">Export JSON</a>
      </div>
    </div>
    <div class="two-col">
      <div class="mini-panel">
        <h3>Run Info</h3>
        <div class="muted">Run ID: ${escapeHtml(run.runId)}</div>
        <div class="muted">User: ${escapeHtml(run.userId)}</div>
        <div class="muted">Updated: ${formatDateTime(run.updatedAt)}</div>
        <div class="muted">Source: ${escapeHtml(run.sourcePost.authorHandle ?? "unknown")}</div>
        ${summary ? `<div class="muted">Result: ${escapeHtml(summary)}</div>` : ""}
        ${run.error ? `<div class="step-error">Error: ${escapeHtml(run.error)}</div>` : ""}
      </div>
      <div class="mini-panel">
        <h3>Spend</h3>
        <div class="muted">${formatNumber(totals.total)} total tokens</div>
        <div class="muted">${formatNumber(totals.input)} input / ${formatNumber(totals.output)} output</div>
        <div class="muted">${formatNumber(totals.reasoning)} reasoning / ${formatNumber(totals.cached)} cached</div>
        <div class="muted">${formatUsd(totals.costUsd)} estimated</div>
      </div>
    </div>
    <div class="two-col">
      <div class="mini-panel">
        <h3>Run Waterfall</h3>
        ${renderRunWaterfall(context.steps, context.usage)}
      </div>
      <div class="mini-panel">
        <h3>Model Calls</h3>
        ${context.usage.length === 0 ? `<div class="muted">No model usage recorded.</div>` : context.usage.map(renderUsageRow).join("")}
      </div>
    </div>
    <div class="two-col">
      <div class="mini-panel wide-panel">
        <h3>Reasoning Summaries</h3>
        ${renderThinkingTraces(thinkingTraces)}
      </div>
    </div>
    <div class="two-col">
      <div class="mini-panel">
        <h3>Tickets</h3>
        ${context.tickets.length === 0 ? `<div class="muted">No tickets created.</div>` : context.tickets.map(renderTicketRow).join("")}
      </div>
      <div class="mini-panel">
        <h3>Jobs</h3>
        ${context.jobs.length === 0 ? `<div class="muted">No execution jobs linked.</div>` : context.jobs.map(renderJobRow).join("")}
      </div>
    </div>
    <details>
      <summary class="muted">Raw run result</summary>
      <pre>${escapeHtml(formatJson(run.result))}</pre>
    </details>
  </article>`;
}

function renderRunWaterfall(steps: RunStep[], usage: ModelCallUsageRecord[]): string {
  const items = buildWaterfallItems(steps, usage);
  if (items.length === 0) {
    return `<div class="muted">No step timing recorded.</div>`;
  }
  const maxValue = Math.max(...items.map((item) => item.durationMs ?? item.tokens), 1);
  return `<div class="waterfall">
    ${items.map((item) => {
      const value = item.durationMs ?? item.tokens;
      const width = Math.max(4, Math.round((value / maxValue) * 100));
      return `<div class="waterfall-row">
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <div class="quiet">${formatTime(item.at)}</div>
        </div>
        <div>
          <div class="muted">${escapeHtml(item.detail)}</div>
          <div class="bar-track"><div class="bar-fill ${item.status === "failed" ? "failed" : ""}" style="--bar-width: ${width}%"></div></div>
          ${item.error ? `<div class="step-error">Error: ${escapeHtml(item.error)}</div>` : ""}
        </div>
        <div>${statusBadge(item.status)}<div class="quiet">${item.durationMs === null ? `${formatNumber(item.tokens)} tokens` : formatDuration(item.durationMs)}</div></div>
      </div>`;
    }).join("")}
  </div>`;
}

function buildWaterfallItems(steps: RunStep[], usage: ModelCallUsageRecord[]): WaterfallItem[] {
  const stepItems = steps.map((step) => {
    const matchingUsage = usage.filter((record) => record.runStepId === step.stepId);
    const tokens = summarizeTokenUsage(matchingUsage).total;
    return {
      at: step.startedAt,
      label: step.stepType,
      detail: `${step.model ?? "no model"}${step.promptName ? ` / ${step.promptName}` : ""}`,
      status: step.status,
      durationMs: step.completedAt ? durationMs(step.startedAt, step.completedAt) : null,
      tokens,
      error: step.error,
    };
  });
  const supervisorCalls = usage
    .filter((record) => record.runStepId === null)
    .map((record) => ({
      at: record.createdAt,
      label: record.purpose,
      detail: `${record.model}${record.promptName ? ` / ${record.promptName}` : ""}`,
      status: record.status,
      durationMs: null,
      tokens: record.totalTokens ?? 0,
      error: record.error,
    }));
  return [...stepItems, ...supervisorCalls].sort((left, right) => left.at.localeCompare(right.at));
}

function renderJobsTable(jobs: ExecutionJob[], tickets: TradeTicket[]): string {
  if (jobs.length === 0) {
    return `<div class="empty">No execution jobs recorded yet.</div>`;
  }

  const ticketById = new Map(tickets.map((ticket) => [ticket.ticketId, ticket]));
  return `<table>
    <thead>
      <tr>
        <th>Job</th>
        <th>Status</th>
        <th>Ticket</th>
        <th>Updated</th>
        <th>More Info</th>
      </tr>
    </thead>
    <tbody>
      ${jobs.map((job) => {
        const ticket = ticketById.get(job.ticketId);
        return `<tr>
          <td><strong>${escapeHtml(job.jobId)}</strong></td>
          <td>${statusBadge(job.status)}</td>
          <td>${ticket ? `${escapeHtml(ticket.instrument)}<br><span class="quiet">${escapeHtml(ticket.side)} / ${escapeHtml(ticket.venue)}</span>` : escapeHtml(job.ticketId)}</td>
          <td>${formatDateTime(job.updatedAt)}<br><span class="quiet">created ${formatDateTime(job.createdAt)}</span></td>
          <td>${job.failureReason ? escapeHtml(job.failureReason) : job.executionResult ? escapeHtml(formatExecutionResult(job)) : "Waiting for execution result."}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
}

function renderTokenBreakdown(totals: TokenTotals): string {
  return `<div class="grid token-grid">
    ${metric("Total", `${formatNumber(totals.total)} tokens`, `${formatUsd(totals.costUsd)} estimated`)}
    ${metric("Input", formatNumber(totals.input), `${formatNumber(totals.cached)} cached`)}
    ${metric("Output", formatNumber(totals.output), `${formatNumber(totals.reasoning)} reasoning`)}
    ${metric("Failures", String(totals.failedCalls), `${totals.calls} model calls tracked`)}
  </div>`;
}

function renderSpendBreakdowns(records: ModelCallUsageRecord[]): string {
  return `<div class="two-col">
    <div class="mini-panel">
      <h3>Spend by Model</h3>
      ${renderSpendGroups(groupSpend(records, (record) => record.model, (record) => record.provider))}
    </div>
    <div class="mini-panel">
      <h3>Spend by Prompt</h3>
      ${renderSpendGroups(groupSpend(records, (record) => record.promptName ?? record.purpose, (record) => record.model))}
    </div>
  </div>`;
}

function renderSpendGroups(groups: SpendGroup[]): string {
  if (groups.length === 0) {
    return `<div class="muted">No spend recorded.</div>`;
  }
  return groups.slice(0, 8).map((group) => `<div class="row">
    <div>
      <strong>${escapeHtml(group.key)}</strong>
      <div class="muted">${escapeHtml(group.subtitle)}</div>
    </div>
    <div class="quiet">${formatNumber(group.totals.total)} tokens<br>${group.totals.failedCalls} failed</div>
  </div>`).join("");
}

function groupSpend(
  records: ModelCallUsageRecord[],
  keyForRecord: (record: ModelCallUsageRecord) => string,
  subtitleForRecord: (record: ModelCallUsageRecord) => string,
): SpendGroup[] {
  const groups = new Map<string, { records: ModelCallUsageRecord[]; subtitles: Set<string> }>();
  for (const record of records) {
    const key = keyForRecord(record);
    const group = groups.get(key) ?? { records: [], subtitles: new Set<string>() };
    group.records.push(record);
    group.subtitles.add(subtitleForRecord(record));
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      subtitle: [...group.subtitles].slice(0, 3).join(" / "),
      totals: summarizeTokenUsage(group.records),
    }))
    .sort((left, right) => right.totals.total - left.totals.total);
}

function buildThinkingTraces(steps: RunStep[], usage: ModelCallUsageRecord[]): ThinkingTraceItem[] {
  return [
    ...steps.flatMap((step) => {
      const trace = step.thinkingTrace?.trim();
      if (!trace) return [];
      return [{
        at: step.completedAt ?? step.startedAt,
        source: "step" as const,
        title: step.stepType,
        detail: `${step.model ?? "no model"}${step.promptName ? ` / ${step.promptName}` : ""}`,
        status: step.status,
        trace,
      }];
    }),
    ...usage.flatMap((record) => {
      const trace = record.thinkingTrace?.trim();
      if (!trace) return [];
      return [{
        at: record.createdAt,
        source: "model.call" as const,
        title: record.purpose,
        detail: `${record.model}${record.promptName ? ` / ${record.promptName}` : ""}`,
        status: record.status,
        trace,
      }];
    }),
  ].sort((left, right) => left.at.localeCompare(right.at));
}

function renderThinkingTraces(items: ThinkingTraceItem[]): string {
  if (items.length === 0) {
    return `<div class="muted">No reasoning summaries recorded.</div>`;
  }

  return items.map((item) => `<div class="thinking-trace">
    <div class="trace-head">
      <strong>${escapeHtml(item.title)}</strong>
      <span class="status">${escapeHtml(item.source)}</span>
      ${statusBadge(item.status)}
      <span class="quiet">${escapeHtml(item.detail)}</span>
    </div>
    <div class="trace-text">${escapeHtml(item.trace)}</div>
  </div>`).join("");
}

function renderUsageTable(records: ModelCallUsageRecord[]): string {
  const sortedRecords = records.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (sortedRecords.length === 0) {
    return `<div class="empty">No model usage recorded yet.</div>`;
  }

  return `<table>
    <thead>
      <tr>
        <th>Model</th>
        <th>Purpose</th>
        <th>Tokens</th>
        <th>Cost</th>
      </tr>
    </thead>
    <tbody>
      ${sortedRecords.slice(0, 12).map((record) => `<tr>
        <td><strong>${escapeHtml(record.model)}</strong><br><span class="quiet">${escapeHtml(record.provider)}</span></td>
        <td>${escapeHtml(record.purpose)}<br>${statusBadge(record.status)}</td>
        <td>${formatNumber(record.totalTokens ?? 0)}<br><span class="quiet">${formatNumber(record.inputTokens ?? 0)} in / ${formatNumber(record.outputTokens ?? 0)} out</span></td>
        <td>${formatUsd(record.estimatedCostUsd ?? 0)}<br><span class="quiet">${record.latencyMs ? `${formatNumber(record.latencyMs)} ms` : "latency unknown"}</span></td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderFailureTriage(failures: FailureItem[]): string {
  const groups = groupFailures(failures);
  if (groups.length === 0) {
    return `<div class="empty">No failures recorded.</div>`;
  }
  return groups.slice(0, 8).map((group) => `<div class="row">
    <div>
      <strong>${escapeHtml(group.signature)}</strong>
      <div class="muted">${escapeHtml(group.sample)}</div>
      <div class="quiet">Latest run <a href="${attributeValue(dashboardHref({ selectedRunId: group.latestRunId }))}">${escapeHtml(group.latestRunId)}</a></div>
    </div>
    <div class="quiet">${group.count} hits<br>${formatNumber(group.tokens)} tokens</div>
  </div>`).join("");
}

function collectFailures(state: CassieStoreSnapshot): FailureItem[] {
  const runFailures = state.controlRuns.flatMap((run) => run.error
    ? [{
      at: run.updatedAt,
      runId: run.runId,
      source: "run",
      model: null,
      promptName: null,
      tokens: summarizeTokenUsage(state.modelCallUsage.filter((record) => record.controlRunId === run.runId)).total,
      error: run.error,
    }]
    : []);
  const stepFailures = state.runSteps.flatMap((step) => step.error
    ? [{
      at: step.completedAt ?? step.startedAt,
      runId: step.runId,
      source: step.stepType,
      model: step.model,
      promptName: step.promptName ?? null,
      tokens: summarizeTokenUsage(state.modelCallUsage.filter((record) => record.runStepId === step.stepId)).total,
      error: step.error,
    }]
    : []);
  const callFailures = state.modelCallUsage.flatMap((record) => record.error
    ? [{
      at: record.createdAt,
      runId: record.controlRunId,
      source: record.purpose,
      model: record.model,
      promptName: record.promptName,
      tokens: record.totalTokens ?? 0,
      error: record.error,
    }]
    : []);
  return [...runFailures, ...stepFailures, ...callFailures].sort((left, right) => right.at.localeCompare(left.at));
}

function groupFailures(failures: FailureItem[]): GroupedFailure[] {
  const groups = new Map<string, GroupedFailure>();
  for (const failure of failures) {
    const signature = failureSignature(failure.error);
    const existing = groups.get(signature);
    if (!existing) {
      groups.set(signature, {
        signature,
        count: 1,
        tokens: failure.tokens,
        latestAt: failure.at,
        latestRunId: failure.runId,
        sample: compactError(failure.error),
      });
      continue;
    }
    existing.count += 1;
    existing.tokens += failure.tokens;
    if (failure.at > existing.latestAt) {
      existing.latestAt = failure.at;
      existing.latestRunId = failure.runId;
      existing.sample = compactError(failure.error);
    }
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || right.latestAt.localeCompare(left.latestAt));
}

function failureSignature(error: string): string {
  const first = compactError(error).split(":").slice(0, 2).join(":").trim();
  return first || "Unknown failure";
}

function compactError(error: string): string {
  return error.replace(/\s+/g, " ").slice(0, 220);
}

function renderPendingTickets(tickets: TradeTicket[]): string {
  if (tickets.length === 0) {
    return `<div class="empty">No pending tickets.</div>`;
  }

  return tickets.map((ticket) => `<div class="row">
    <div>
      <strong>${escapeHtml(ticket.instrument)} ${escapeHtml(ticket.side)}</strong>
      <div class="muted">${escapeHtml(ticket.venue)} / ${formatUsd(ticket.sizeUsd)}</div>
      <div class="muted truncate">${escapeHtml(ticket.thesis)}</div>
    </div>
    <form method="post" action="/api/tickets/${attributeValue(ticket.ticketId)}/approve">
      <button type="submit">Approve</button>
    </form>
  </div>`).join("");
}

function renderTimeline(items: TimelineItem[]): string {
  if (items.length === 0) {
    return `<div class="empty">No timeline events recorded yet.</div>`;
  }

  return `<div class="timeline">
    ${items.map((item) => `<div class="event">
      <div class="event-time">${formatTime(item.at)}</div>
      <div>
        <div class="event-title">
          <strong>${item.href ? `<a href="${attributeValue(item.href)}">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</strong>
          <span class="status">${escapeHtml(item.type)}</span>
          ${item.status ? statusBadge(item.status) : ""}
        </div>
        <div class="event-detail">${escapeHtml(item.detail)}</div>
      </div>
    </div>`).join("")}
  </div>`;
}

function renderUsageRow(record: ModelCallUsageRecord): string {
  return `<div class="row">
    <div>
      <strong>${escapeHtml(record.purpose)}</strong>
      <div class="muted">${escapeHtml(record.model)} / ${escapeHtml(record.promptName ?? "prompt unknown")}</div>
      ${record.error ? `<div class="step-error">Error: ${escapeHtml(record.error)}</div>` : ""}
    </div>
    <div>${statusBadge(record.status)}<div class="quiet">${formatNumber(record.totalTokens ?? 0)} tokens</div></div>
  </div>`;
}

function renderTicketRow(ticket: TradeTicket): string {
  return `<div class="row">
    <div>
      <strong>${escapeHtml(ticket.instrument)}</strong>
      <div class="muted">${escapeHtml(ticket.side)} / ${escapeHtml(ticket.venue)} / ${formatUsd(ticket.sizeUsd)}</div>
    </div>
    ${statusBadge(ticket.approvalState)}
  </div>`;
}

function renderJobRow(job: ExecutionJob): string {
  return `<div class="row">
    <div>
      <strong>${escapeHtml(job.jobId)}</strong>
      <div class="muted">Ticket ${escapeHtml(job.ticketId)}</div>
    </div>
    ${statusBadge(job.status)}
  </div>`;
}

function buildTimeline(state: CassieStoreSnapshot): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const run of state.controlRuns) {
    items.push({
      at: run.createdAt,
      type: "control.run",
      title: run.runId,
      detail: run.userCommand,
      status: run.status,
      href: dashboardHref({ selectedRunId: run.runId }),
    });
  }
  for (const step of state.runSteps) {
    items.push({
      at: step.startedAt,
      type: "run.step",
      title: step.stepType,
      detail: `${step.model ?? "no model"} / ${step.promptName ?? "no prompt"}`,
      status: step.status,
      href: dashboardHref({ selectedRunId: step.runId }),
    });
  }
  for (const record of state.modelCallUsage) {
    items.push({
      at: record.createdAt,
      type: "model.call",
      title: record.purpose,
      detail: `${record.model} spent ${formatNumber(record.totalTokens ?? 0)} tokens`,
      status: record.status,
      href: dashboardHref({ selectedRunId: record.controlRunId }),
    });
  }
  for (const job of state.executionJobs) {
    items.push({
      at: job.updatedAt,
      type: "execution.job",
      title: job.jobId,
      detail: `Ticket ${job.ticketId}`,
      status: job.status,
    });
  }
  for (const ticket of state.tradeTickets) {
    if (!ticket.runId) continue;
    items.push({
      at: state.controlRuns.find((run) => run.runId === ticket.runId)?.updatedAt ?? new Date(0).toISOString(),
      type: "trade.ticket",
      title: ticket.ticketId,
      detail: `${ticket.instrument} ${ticket.side} ${formatUsd(ticket.sizeUsd)}`,
      status: ticket.approvalState,
      href: dashboardHref({ selectedRunId: ticket.runId }),
    });
  }
  for (const event of state.auditEvents) {
    items.push({
      at: event.createdAt,
      type: "audit",
      title: event.eventType,
      detail: event.message,
    });
  }

  return items.sort((left, right) => right.at.localeCompare(left.at));
}

function normalizeDashboardOptions(options: DashboardOptions): DashboardFilters {
  const refreshSeconds = typeof options.refreshSeconds === "number" && [5, 10, 30, 60].includes(options.refreshSeconds)
    ? options.refreshSeconds
    : null;
  return {
    query: (options.query ?? "").trim(),
    status: (options.status ?? "").trim(),
    model: (options.model ?? "").trim(),
    selectedRunId: (options.selectedRunId ?? "").trim(),
    refreshSeconds,
  };
}

function filterRuns(state: CassieStoreSnapshot, runs: ControlRun[], filters: DashboardFilters): ControlRun[] {
  return runs.filter((run) => {
    if (filters.status && run.status !== filters.status) return false;
    if (filters.model && !state.modelCallUsage.some((record) => record.controlRunId === run.runId && record.model === filters.model)) return false;
    if (filters.query && !buildRunSearchText(state, run).includes(filters.query.toLowerCase())) return false;
    return true;
  });
}

function buildRunSearchText(state: CassieStoreSnapshot, run: ControlRun): string {
  const context = runContext(state, run);
  return [
    run.runId,
    run.userId,
    run.userCommand,
    run.status,
    run.error ?? "",
    run.sourcePost.authorHandle ?? "",
    run.sourcePost.text,
    ...context.steps.flatMap((step) => [step.stepType, step.status, step.error ?? "", step.model ?? "", step.promptName ?? ""]),
    ...context.usage.flatMap((record) => [record.purpose, record.status, record.error ?? "", record.model, record.promptName ?? ""]),
    ...context.tickets.flatMap((ticket) => [ticket.ticketId, ticket.instrument, ticket.venue, ticket.side, ticket.thesis]),
    ...context.jobs.flatMap((job) => [job.jobId, job.status, job.failureReason ?? ""]),
  ].join(" ").toLowerCase();
}

function chooseSelectedRun(runs: ControlRun[], filteredRuns: ControlRun[], selectedRunId: string): ControlRun | null {
  return filteredRuns.find((run) => run.runId === selectedRunId)
    ?? filteredRuns[0]
    ?? runs.find((run) => run.runId === selectedRunId)
    ?? null;
}

function runContext(state: CassieStoreSnapshot, run: ControlRun) {
  const steps = state.runSteps
    .filter((step) => step.runId === run.runId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const usage = state.modelCallUsage
    .filter((record) => record.controlRunId === run.runId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const tickets = state.tradeTickets.filter((ticket) => ticket.runId === run.runId);
  const ticketIds = new Set(tickets.map((ticket) => ticket.ticketId));
  const jobs = state.executionJobs.filter((job) => ticketIds.has(job.ticketId));
  return { run, steps, usage, tickets, jobs };
}

function summarizeTokenUsage(records: ModelCallUsageRecord[]): TokenTotals {
  return records.reduce(
    (totals, record) => ({
      input: totals.input + (record.inputTokens ?? 0),
      output: totals.output + (record.outputTokens ?? 0),
      reasoning: totals.reasoning + (record.reasoningTokens ?? 0),
      cached: totals.cached + (record.cachedTokens ?? 0),
      total: totals.total + (record.totalTokens ?? 0),
      costUsd: totals.costUsd + (record.estimatedCostUsd ?? 0),
      calls: totals.calls + 1,
      failedCalls: totals.failedCalls + (record.status === "failed" ? 1 : 0),
    }),
    { input: 0, output: 0, reasoning: 0, cached: 0, total: 0, costUsd: 0, calls: 0, failedCalls: 0 },
  );
}

function dashboardHref(input: Partial<DashboardFilters>): string {
  const params = new URLSearchParams();
  const query = input.query ?? "";
  const status = input.status ?? "";
  const model = input.model ?? "";
  const selectedRunId = input.selectedRunId ?? "";
  const refreshSeconds = input.refreshSeconds ?? null;
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  if (model) params.set("model", model);
  if (selectedRunId) params.set("run", selectedRunId);
  if (refreshSeconds) params.set("refresh", String(refreshSeconds));
  const qs = params.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

function metric(label: string, value: string, note: string): string {
  return `<div class="metric">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
    <div class="metric-note">${escapeHtml(note)}</div>
  </div>`;
}

function statusSummary(statuses: string[]): string {
  if (statuses.length === 0) {
    return "none";
  }
  const counts = new Map<string, number>();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${count} ${status}`)
    .join(" / ");
}

function statusBadge(status: string): string {
  return `<span class="status status-${attributeValue(status)}">${escapeHtml(status)}</span>`;
}

function resultSummary(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as Record<string, unknown>;
  const pieces = [record.responseType, record.actionState, record.ticketId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return pieces.length > 0 ? pieces.join(" / ") : null;
}

function formatExecutionResult(job: ExecutionJob): string {
  if (!job.executionResult) {
    return "";
  }
  const { venueOrderId, filledSizeUsd, averagePrice } = job.executionResult;
  return `filled ${formatUsd(filledSizeUsd)}${averagePrice === null ? "" : ` @ ${averagePrice}`}${venueOrderId ? ` / ${venueOrderId}` : ""}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(value: number): string {
  const digits = Math.abs(value) > 0 && Math.abs(value) < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function durationMs(start: string, end: string): number {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }
  return `${Math.round(ms / 60_000)}m`;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function option(value: string, label: string, selected: string): string {
  return `<option value="${attributeValue(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function attributeValue(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
