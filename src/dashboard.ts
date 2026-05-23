import type { CassieStoreSnapshot, ModelCallUsageRecord } from "../packages/core/db/store.ts";
import type { ControlRun, ExecutionJob, RunStep, TradeTicket } from "../packages/core/schemas/index.ts";

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

export function renderDashboard(state: CassieStoreSnapshot): string {
  const tokenTotals = summarizeTokenUsage(state.modelCallUsage);
  const pendingTickets = state.tradeTickets.filter((ticket) => ticket.approvalState === "pending");
  const sortedRuns = state.controlRuns.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const sortedJobs = state.executionJobs.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const timeline = buildTimeline(state).slice(0, 80);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cassie Admin</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1115;
      --panel: #171a20;
      --panel-2: #1d2129;
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
      padding: 18px 24px;
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
    main {
      display: grid;
      gap: 18px;
      padding: 18px;
    }
    section {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 16px;
      min-width: 0;
    }
    button {
      border: 1px solid var(--line);
      background: #222733;
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
      font: inherit;
    }
    button:hover { border-color: var(--muted); }
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
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      border: 1px solid var(--line);
      background: var(--panel-2);
      border-radius: 8px;
      padding: 13px;
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
      font-size: 24px;
      line-height: 1.1;
      font-weight: 700;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .metric-note { margin-top: 5px; color: var(--muted); font-size: 12px; }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(340px, 0.9fr);
      gap: 18px;
      align-items: start;
    }
    .stack { display: grid; gap: 18px; min-width: 0; }
    .row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line-soft);
      padding: 12px 0;
    }
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
    .timeline {
      position: relative;
      display: grid;
      gap: 0;
    }
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
    .run-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 14px;
    }
    .run-card + .run-card { margin-top: 12px; }
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
    }
    .mini-panel h3 { margin-bottom: 8px; }
    .empty {
      color: var(--muted);
      padding: 12px 0 0;
    }
    .truncate {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    @media (max-width: 980px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .layout { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      header { align-items: flex-start; flex-direction: column; }
      main { padding: 12px; }
      section { padding: 13px; }
      .grid, .two-col, .token-grid { grid-template-columns: 1fr; }
      .metric-value { font-size: 21px; }
      .timeline::before { left: 71px; }
      .event { grid-template-columns: 56px 1fr; gap: 28px; }
      .event::after { left: 67px; }
      th:nth-child(4), td:nth-child(4) { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Cassie Admin</h1>
      <div class="subhead">Runs, execution jobs, token spend, tickets, and audit activity.</div>
    </div>
    <span class="status">${formatDateTime(new Date().toISOString())}</span>
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
    <div class="layout">
      <div class="stack">
        <section aria-labelledby="jobs-title">
          <div class="topline">
            <div>
              <h2 id="jobs-title">Execution Jobs</h2>
              <div class="subhead">Every execution job with ticket, status, result, and failure context.</div>
            </div>
          </div>
          ${renderJobsTable(sortedJobs, state.tradeTickets)}
        </section>
        <section aria-labelledby="runs-title">
          <div class="topline">
            <div>
              <h2 id="runs-title">Runs</h2>
              <div class="subhead">Open a run for steps, token calls, linked tickets, and job detail.</div>
            </div>
          </div>
          ${sortedRuns.length === 0 ? `<div class="empty">No runs recorded yet.</div>` : sortedRuns.map((run) => renderRunCard(state, run)).join("")}
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
          ${renderUsageTable(state.modelCallUsage)}
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
  </main>
</body>
</html>`;
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

function renderRunCard(state: CassieStoreSnapshot, run: ControlRun): string {
  const steps = state.runSteps
    .filter((step) => step.runId === run.runId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const usage = state.modelCallUsage
    .filter((record) => record.controlRunId === run.runId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const tickets = state.tradeTickets.filter((ticket) => ticket.runId === run.runId);
  const ticketIds = new Set(tickets.map((ticket) => ticket.ticketId));
  const jobs = state.executionJobs.filter((job) => ticketIds.has(job.ticketId));
  const totals = summarizeTokenUsage(usage);
  const summary = resultSummary(run.result);

  return `<article class="run-card" id="run-${attributeValue(run.runId)}">
    <details>
      <summary>
        <strong>${escapeHtml(run.userCommand)}</strong>
        <div class="run-meta">
          ${statusBadge(run.status)}
          <span class="status">${formatDateTime(run.createdAt)}</span>
          <span class="status">${formatNumber(totals.total)} tokens</span>
          <span class="status">${steps.length} steps</span>
          <span class="status">${tickets.length} tickets</span>
        </div>
      </summary>
      <div class="two-col">
        <div class="mini-panel">
          <h3>Run Info</h3>
          <div class="muted">Run ID: ${escapeHtml(run.runId)}</div>
          <div class="muted">User: ${escapeHtml(run.userId)}</div>
          <div class="muted">Updated: ${formatDateTime(run.updatedAt)}</div>
          <div class="muted">Source: ${escapeHtml(run.sourcePost.authorHandle ?? "unknown")} ${run.sourcePost.url ? `<a href="${attributeValue(run.sourcePost.url)}">${escapeHtml(run.sourcePost.url)}</a>` : ""}</div>
          ${summary ? `<div class="muted">Result: ${escapeHtml(summary)}</div>` : ""}
          ${run.error ? `<div class="muted">Error: ${escapeHtml(run.error)}</div>` : ""}
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
          <h3>Steps</h3>
          ${steps.length === 0 ? `<div class="muted">No steps recorded.</div>` : steps.map(renderStepRow).join("")}
        </div>
        <div class="mini-panel">
          <h3>Model Calls</h3>
          ${usage.length === 0 ? `<div class="muted">No model usage recorded.</div>` : usage.map(renderUsageRow).join("")}
        </div>
      </div>
      <div class="two-col">
        <div class="mini-panel">
          <h3>Tickets</h3>
          ${tickets.length === 0 ? `<div class="muted">No tickets created.</div>` : tickets.map(renderTicketRow).join("")}
        </div>
        <div class="mini-panel">
          <h3>Jobs</h3>
          ${jobs.length === 0 ? `<div class="muted">No execution jobs linked.</div>` : jobs.map(renderJobRow).join("")}
        </div>
      </div>
      <details>
        <summary class="muted">Raw run result</summary>
        <pre>${escapeHtml(formatJson(run.result))}</pre>
      </details>
    </details>
  </article>`;
}

function renderTokenBreakdown(totals: TokenTotals): string {
  return `<div class="grid token-grid">
    ${metric("Total", `${formatNumber(totals.total)} tokens`, `${formatUsd(totals.costUsd)} estimated`)}
    ${metric("Input", formatNumber(totals.input), `${formatNumber(totals.cached)} cached`)}
    ${metric("Output", formatNumber(totals.output), `${formatNumber(totals.reasoning)} reasoning`)}
    ${metric("Failures", String(totals.failedCalls), `${totals.calls} model calls tracked`)}
  </div>`;
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

function renderStepRow(step: RunStep): string {
  const duration = step.completedAt ? durationMs(step.startedAt, step.completedAt) : null;
  return `<div class="row">
    <div>
      <strong>${escapeHtml(step.stepType)}</strong>
      <div class="muted">${escapeHtml(step.model ?? "no model")} ${step.promptName ? `/ ${escapeHtml(step.promptName)}` : ""}</div>
      ${step.error ? `<div class="muted">Error: ${escapeHtml(step.error)}</div>` : ""}
    </div>
    <div>${statusBadge(step.status)}<div class="quiet">${duration === null ? "open" : formatDuration(duration)}</div></div>
  </div>`;
}

function renderUsageRow(record: ModelCallUsageRecord): string {
  return `<div class="row">
    <div>
      <strong>${escapeHtml(record.purpose)}</strong>
      <div class="muted">${escapeHtml(record.model)} / ${escapeHtml(record.promptName ?? "prompt unknown")}</div>
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
      href: `#run-${run.runId}`,
    });
  }
  for (const step of state.runSteps) {
    items.push({
      at: step.startedAt,
      type: "run.step",
      title: step.stepType,
      detail: `${step.model ?? "no model"} / ${step.promptName ?? "no prompt"}`,
      status: step.status,
      href: `#run-${step.runId}`,
    });
  }
  for (const record of state.modelCallUsage) {
    items.push({
      at: record.createdAt,
      type: "model.call",
      title: record.purpose,
      detail: `${record.model} spent ${formatNumber(record.totalTokens ?? 0)} tokens`,
      status: record.status,
      href: `#run-${record.controlRunId}`,
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
      href: `#run-${ticket.runId}`,
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
