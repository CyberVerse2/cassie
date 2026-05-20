import type { CassieStoreSnapshot } from "./store.ts";

export function renderDashboard(state: CassieStoreSnapshot): string {
  const pendingTickets = state.tradeTickets.filter(
    (ticket) => ticket.approvalState === "pending",
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cassie</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101114;
      --panel: #191b20;
      --line: #30343c;
      --text: #f4f1e8;
      --muted: #a9afbd;
      --green: #73d18f;
      --red: #ff8a8a;
      --yellow: #f0c36d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      border-bottom: 1px solid var(--line);
      padding: 18px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1, h2 { margin: 0; font-weight: 650; letter-spacing: 0; }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
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
    .stack { display: grid; gap: 12px; }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding: 10px 0;
    }
    .row:last-child { border-bottom: 0; }
    .muted { color: var(--muted); }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      white-space: nowrap;
      color: var(--muted);
    }
    button {
      border: 1px solid var(--line);
      background: #22252b;
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
    }
    button:hover { border-color: var(--muted); }
    pre {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      white-space: pre-wrap;
      color: var(--muted);
    }
    @media (max-width: 840px) {
      main { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Cassie</h1>
    <span class="muted">${state.runs.length} runs / ${state.tradeTickets.length} tickets / ${state.auditEvents.length} audit events</span>
  </header>
  <main>
    <div class="stack">
      <section>
        <h2>Pending Tickets</h2>
        ${pendingTickets.length === 0 ? `<p class="muted">No pending tickets.</p>` : pendingTickets.map((ticket) => `
          <div class="row">
            <div>
              <strong>${escapeHtml(ticket.instrument)} ${escapeHtml(ticket.side)}</strong>
              <div class="muted">${escapeHtml(ticket.venue)} / $${ticket.sizeUsd}</div>
              <div class="muted">${escapeHtml(ticket.thesis)}</div>
            </div>
            <form method="post" action="/api/tickets/${ticket.ticketId}/approve">
              <button type="submit">Approve</button>
            </form>
          </div>
        `).join("")}
      </section>
      <section>
        <h2>Runs</h2>
        ${state.runs.slice().reverse().map((run) => `
          <div class="row">
            <div>
              <strong>${escapeHtml(run.responseType)}</strong>
              <div class="muted">${escapeHtml(run.userCommand)}</div>
            </div>
            <span class="pill">${new Date(run.createdAt).toLocaleString()}</span>
          </div>
        `).join("")}
      </section>
    </div>
    <section>
      <h2>Audit</h2>
      <pre>${escapeHtml(JSON.stringify(state.auditEvents.slice(-30).reverse(), null, 2))}</pre>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
