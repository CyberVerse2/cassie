"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  AdminData,
  AdminOps,
  AdminOverview,
  AdminRunDetail,
  AdminRunStepDetail,
  AdminRunRow,
  AdminTradeRow,
  AdminUserRow,
} from "../../../../packages/app/admin-metrics";
import s from "./admin.module.css";

const TOKEN_KEY = "cassie_admin_token";

type TabKey = "overview" | "users" | "runs" | "trades" | "ops";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "runs", label: "Runs" },
  { key: "trades", label: "Trades" },
  { key: "ops", label: "Ops" },
];

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY));
    setHydrated(true);
  }, []);

  const signIn = useCallback((value: string) => {
    window.localStorage.setItem(TOKEN_KEY, value);
    setToken(value);
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  if (!hydrated) return <main className={s.shell} />;
  if (!token) return <TokenGate onSubmit={signIn} />;
  return <AdminConsole token={token} onSignOut={signOut} />;
}

function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <main className={s.gateShell}>
      <form
        className={s.gateCard}
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <span className={s.gateBadge}>Cassie Ops</span>
        <h1 className={s.gateTitle}>Admin console</h1>
        <p className={s.gateCopy}>
          Enter the operator token to view users, runs, trades, and system health.
        </p>
        <input
          className={s.gateInput}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="CASSIE_ADMIN_TOKEN"
          autoFocus
          aria-label="Admin token"
        />
        <button className={s.gateButton} type="submit">
          Unlock
        </button>
      </form>
    </main>
  );
}

function AdminConsole({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/overview", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.status === 401) {
        onSignOut();
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load admin data.");
      setData(payload as AdminData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [token, onSignOut]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.brand}>
          <img src="/cassie-logo-transparent.png" alt="" aria-hidden />
          <div>
            <span className={s.brandName}>Cassie</span>
            <span className={s.brandSub}>Admin console</span>
          </div>
        </div>
        <nav className={s.nav} aria-label="Admin sections">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`${s.navItem} ${tab === entry.key ? s.navItemActive : ""}`}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
              {data ? <span className={s.navCount}>{tabCount(entry.key, data)}</span> : null}
            </button>
          ))}
        </nav>
        <button type="button" className={s.signOut} onClick={onSignOut}>
          Sign out
        </button>
      </aside>

      <section className={s.main}>
        <header className={s.topbar}>
          <div>
            <h1 className={s.pageTitle}>{TABS.find((entry) => entry.key === tab)?.label}</h1>
            <p className={s.pageMeta}>
              {data
                ? `Updated ${formatRelative(data.generatedAt)}`
                : loading
                  ? "Loading…"
                  : "No data"}
            </p>
          </div>
          <button type="button" className={s.refresh} onClick={() => void load()} disabled={loading}>
            <RefreshIcon spinning={loading} />
            Refresh
          </button>
        </header>

        {error ? <div className={s.banner}>{error}</div> : null}

        <div className={s.content}>
          {!data && loading ? <div className={s.empty}>Loading admin data…</div> : null}
          {data && tab === "overview" ? <OverviewView overview={data.overview} /> : null}
          {data && tab === "users" ? <UsersView users={data.users} /> : null}
          {data && tab === "runs" ? <RunsView runs={data.runs} onSelectRun={setSelectedRunId} /> : null}
          {data && tab === "trades" ? <TradesView trades={data.trades} onSelectRun={setSelectedRunId} /> : null}
          {data && tab === "ops" ? <OpsView ops={data.ops} /> : null}
        </div>
      </section>

      {selectedRunId ? (
        <RunDetailDrawer token={token} runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
      ) : null}
    </main>
  );
}

function tabCount(key: TabKey, data: AdminData): number {
  if (key === "overview") return data.overview.totals.runs;
  if (key === "users") return data.users.length;
  if (key === "runs") return data.runs.length;
  if (key === "trades") return data.trades.length;
  return data.ops.workerFailures.recent.length;
}

function OverviewView({ overview }: { overview: AdminOverview }) {
  const t = overview.totals;
  const cards: { label: string; value: string; hint: string; tone?: "bad" }[] = [
    { label: "Users", value: formatInt(t.users), hint: `${formatInt(t.activeUsers)} active · 7d` },
    { label: "Active users", value: formatInt(t.activeUsers), hint: "active in last 7 days" },
    { label: "Mentions", value: formatInt(t.mentions), hint: "tweets tagging Cassie" },
    { label: "Runs", value: formatInt(t.runs), hint: "supervisor runs" },
    { label: "Tokens consumed", value: formatTokens(t.tokensConsumed), hint: "model usage recorded" },
    { label: "Tickets", value: formatInt(t.tickets), hint: "trade tickets created" },
    { label: "Executed volume", value: formatUsd(t.executedVolumeUsd), hint: "filled notional" },
    { label: "Failed jobs", value: formatInt(t.failedJobs), tone: t.failedJobs > 0 ? "bad" : undefined, hint: "execution failures" },
  ];

  return (
    <div className={s.stack}>
      <div className={s.cardGrid}>
        {cards.map((card) => (
          <div className={s.statCard} key={card.label}>
            <span className={s.statLabel}>{card.label}</span>
            <span className={`${s.statValue} ${card.tone === "bad" ? s.statBad : ""}`}>{card.value}</span>
            <span className={s.statHint}>{card.hint}</span>
          </div>
        ))}
      </div>

      <div className={s.panel}>
        <div className={s.panelHead}>
          <h2>Runs · last 14 days</h2>
          <span className={s.panelMeta}>{formatInt(overview.runsTrend.reduce((sum, d) => sum + d.runs, 0))} total</span>
        </div>
        <TrendChart data={overview.runsTrend} />
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: { date: string; runs: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.runs));
  return (
    <div className={s.trend}>
      {data.map((point) => (
        <div className={s.trendCol} key={point.date} title={`${point.date}: ${point.runs} runs`}>
          <div className={s.trendBarTrack}>
            <div
              className={s.trendBar}
              style={{ height: `${Math.max(point.runs === 0 ? 2 : 8, (point.runs / max) * 100)}%` }}
            />
          </div>
          <span className={s.trendLabel}>{point.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function UsersView({ users }: { users: AdminUserRow[] }) {
  if (users.length === 0) return <EmptyState label="No users yet." />;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>User</th>
            <th>Wallet</th>
            <th>Telegram</th>
            <th>Funded</th>
            <th className={s.num}>Mentions</th>
            <th className={s.num}>Runs</th>
            <th className={s.num}>Volume</th>
            <th>Last active</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.userId}>
              <td><code className={s.mono}>{shortId(user.userId)}</code></td>
              <td>{user.walletAddress ? <code className={s.mono}>{shortAddress(user.walletAddress)}</code> : <span className={s.muted}>—</span>}</td>
              <td>{user.telegramConnected ? <span className={s.chipOk}>{user.telegram}</span> : <span className={s.muted}>—</span>}</td>
              <td>{user.funded ? <span className={s.chipOk}>Funded</span> : <span className={s.chipNeutral}>No</span>}</td>
              <td className={s.num}>{formatInt(user.mentions)}</td>
              <td className={s.num}>{formatInt(user.runs)}</td>
              <td className={s.num}>{formatUsd(user.volumeUsd)}</td>
              <td>{user.lastActive ? <span title={user.lastActive}>{formatRelative(user.lastActive)}</span> : <span className={s.muted}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsView({ runs, onSelectRun }: { runs: AdminRunRow[]; onSelectRun: (runId: string) => void }) {
  if (runs.length === 0) return <EmptyState label="No runs yet." />;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Run</th>
            <th>Source tweet</th>
            <th>Status</th>
            <th>Decision</th>
            <th>Outcome</th>
            <th>When</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.runId}
              className={s.clickRow}
              tabIndex={0}
              role="button"
              aria-label={`Open run ${run.runId}`}
              onClick={() => onSelectRun(run.runId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectRun(run.runId);
                }
              }}
            >
              <td><code className={s.mono}>{shortId(run.runId)}</code></td>
              <td className={s.sourceCell}>
                {run.authorHandle ? <span className={s.handle}>{withAt(run.authorHandle)}</span> : null}
                {run.sourceUrl ? (
                  <a
                    className={s.sourceText}
                    href={run.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {truncate(run.sourceText, 96)}
                  </a>
                ) : (
                  <span className={s.sourceText}>{truncate(run.sourceText, 96)}</span>
                )}
              </td>
              <td><StatusBadge status={run.status} /></td>
              <td>{run.decision ? <span className={s.chipNeutral}>{prettify(run.decision)}</span> : <span className={s.muted}>—</span>}</td>
              <td>
                {run.failureReason ? (
                  <span className={s.failText} title={run.failureReason}>{truncate(run.failureReason, 60)}</span>
                ) : run.ticketId ? (
                  <span className={s.chipOk}>ticket {shortId(run.ticketId)}</span>
                ) : run.responseType === "analysis" ? (
                  <span className={s.chipNeutral}>no-trade</span>
                ) : (
                  <span className={s.muted}>—</span>
                )}
              </td>
              <td><span title={run.createdAt}>{formatRelative(run.createdAt)}</span></td>
              <td className={s.rowChevron} aria-hidden>›</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradesView({ trades, onSelectRun }: { trades: AdminTradeRow[]; onSelectRun: (runId: string) => void }) {
  if (trades.length === 0) return <EmptyState label="No trade tickets yet." />;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Venue</th>
            <th>Instrument</th>
            <th>Side</th>
            <th className={s.num}>Size</th>
            <th>Status</th>
            <th>Fill / result</th>
            <th>Failure</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const canOpenRun = Boolean(trade.runId);
            return (
            <tr
              key={trade.ticketId}
              className={canOpenRun ? s.clickRow : undefined}
              tabIndex={canOpenRun ? 0 : undefined}
              role={canOpenRun ? "button" : undefined}
              aria-label={canOpenRun ? `Open run for ticket ${trade.ticketId}` : undefined}
              onClick={canOpenRun ? () => onSelectRun(trade.runId!) : undefined}
              onKeyDown={canOpenRun
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectRun(trade.runId!);
                    }
                  }
                : undefined}
            >
              <td><code className={s.mono}>{shortId(trade.ticketId)}</code></td>
              <td><span className={s.chipNeutral}>{trade.venue}</span></td>
              <td className={s.mono}>{trade.instrument}</td>
              <td><span className={s.sideTag}>{prettify(trade.side)}</span></td>
              <td className={s.num}>{formatUsd(trade.sizeUsd)}</td>
              <td><StatusBadge status={trade.status} /></td>
              <td>
                {trade.filledSizeUsd != null ? (
                  <span className={s.fillText}>
                    {formatUsd(trade.filledSizeUsd)} filled
                    {trade.averagePrice != null ? ` @ ${trade.averagePrice}` : ""}
                  </span>
                ) : (
                  <span className={s.muted}>—</span>
              )}
              </td>
              <td>{trade.failureReason ? <span className={s.failText} title={trade.failureReason}>{truncate(trade.failureReason, 56)}</span> : <span className={s.muted}>—</span>}</td>
              <td className={s.rowChevron} aria-hidden>{canOpenRun ? "›" : ""}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OpsView({ ops }: { ops: AdminOps }) {
  return (
    <div className={s.stack}>
      <div className={s.cardGrid}>
        <div className={s.statCard}>
          <span className={s.statLabel}>Webhook health</span>
          <span className={s.statValue}>{ops.webhook.lastReceivedAt ? formatRelative(ops.webhook.lastReceivedAt) : "—"}</span>
          <span className={s.statHint}>{formatInt(ops.webhook.receivedLast24h)} in 24h · {formatInt(ops.webhook.tracked)} tracked</span>
        </div>
        <div className={s.statCard}>
          <span className={s.statLabel}>Queue backlog</span>
          <span className={`${s.statValue} ${ops.queue.backlog > 0 ? s.statWarn : ""}`}>{formatInt(ops.queue.backlog)}</span>
          <span className={s.statHint}>
            runs {ops.queue.runsQueued + ops.queue.runsRunning} · jobs {ops.queue.jobsQueued + ops.queue.jobsRunning}
          </span>
        </div>
        <div className={s.statCard}>
          <span className={s.statLabel}>Worker failures</span>
          <span className={`${s.statValue} ${ops.workerFailures.failedRuns + ops.workerFailures.failedJobs > 0 ? s.statBad : ""}`}>
            {formatInt(ops.workerFailures.failedRuns + ops.workerFailures.failedJobs + ops.workerFailures.failedSteps)}
          </span>
          <span className={s.statHint}>
            {ops.workerFailures.failedRuns} runs · {ops.workerFailures.failedJobs} jobs · {ops.workerFailures.failedSteps} steps
          </span>
        </div>
        <div className={s.statCard}>
          <span className={s.statLabel}>Model spend</span>
          <span className={s.statValue}>{formatUsd(ops.modelCosts.totalCostUsd)}</span>
          <span className={s.statHint}>
            {formatInt(ops.modelCosts.totalCalls)} calls · {formatInt(ops.modelCosts.failedCalls)} failed
          </span>
        </div>
      </div>

      <div className={s.opsRow}>
        <div className={s.panel}>
          <div className={s.panelHead}><h2>Model costs</h2><span className={s.panelMeta}>{formatTokens(ops.modelCosts.totalTokens)} tokens</span></div>
          {ops.modelCosts.byModel.length === 0 ? (
            <EmptyState label="No model calls recorded." />
          ) : (
            <table className={s.table}>
              <thead>
                <tr><th>Model</th><th className={s.num}>Calls</th><th className={s.num}>Tokens</th><th className={s.num}>Cost</th></tr>
              </thead>
              <tbody>
                {ops.modelCosts.byModel.map((row) => (
                  <tr key={`${row.provider}:${row.model}`}>
                    <td><span className={s.mono}>{row.model}</span><span className={s.subtle}> · {row.provider}</span></td>
                    <td className={s.num}>{formatInt(row.calls)}</td>
                    <td className={s.num}>{formatTokens(row.tokens)}</td>
                    <td className={s.num}>{formatUsd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={s.panel}>
          <div className={s.panelHead}><h2>Recent worker failures</h2></div>
          {ops.workerFailures.recent.length === 0 ? (
            <EmptyState label="No recent failures." />
          ) : (
            <ul className={s.failList}>
              {ops.workerFailures.recent.map((failure) => (
                <li key={`${failure.kind}-${failure.id}`} className={s.failItem}>
                  <div className={s.failTop}>
                    <span className={s.chipBad}>{prettify(failure.kind)}</span>
                    <code className={s.mono}>{shortId(failure.id)}</code>
                    <span className={s.failWhen}>{formatRelative(failure.at)}</span>
                  </div>
                  <span className={s.failReason}>{failure.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={s.panel}>
        <div className={s.panelHead}><h2>Audit trail</h2><span className={s.panelMeta}>{ops.audit.length} latest</span></div>
        {ops.audit.length === 0 ? (
          <EmptyState label="No audit events." />
        ) : (
          <ul className={s.auditList}>
            {ops.audit.map((event) => (
              <li key={event.eventId} className={s.auditItem}>
                <span className={s.auditDot} aria-hidden />
                <span className={s.auditType}>{event.eventType}</span>
                <span className={s.auditMsg}>{event.message}</span>
                <span className={s.auditEntity}>{event.entityType} · {shortId(event.entityId)}</span>
                <span className={s.auditWhen} title={event.createdAt}>{formatRelative(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunDetailDrawer({
  token,
  runId,
  onClose,
}: {
  token: string;
  runId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AdminRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    (async () => {
      try {
        const response = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? "Failed to load run.");
        if (!cancelled) setDetail(payload as AdminRunDetail);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, token]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={s.drawerOverlay} onClick={onClose} role="presentation">
      <aside
        className={s.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Run detail"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={s.drawerHead}>
          <div className={s.drawerTitleWrap}>
            <span className={s.drawerEyebrow}>Run</span>
            <code className={s.drawerId}>{runId}</code>
          </div>
          <button type="button" className={s.drawerClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={s.drawerBody}>
          {loading ? <div className={s.empty}>Loading run…</div> : null}
          {error ? <div className={s.banner}>{error}</div> : null}
          {detail ? <RunDetailBody detail={detail} /> : null}
        </div>
      </aside>
    </div>
  );
}

function RunDetailBody({ detail }: { detail: AdminRunDetail }) {
  return (
    <div className={s.detailStack}>
      <section className={s.detailSection}>
        <div className={s.detailTopRow}>
          <StatusBadge status={detail.status} />
          <span className={s.detailMetaItem}>{prettify(detail.userCommand)}</span>
          <span className={s.detailMetaItem} title={detail.createdAt}>{formatRelative(detail.createdAt)}</span>
        </div>
        <div className={s.detailKv}>
          <span className={s.detailK}>User</span>
          <code className={s.mono}>{detail.userId}</code>
        </div>
        {detail.error ? (
          <div className={s.detailError}>{detail.error}</div>
        ) : null}
      </section>

      <section className={s.detailSection}>
        <h3 className={s.detailHeading}>Source tweet</h3>
        <div className={s.detailTweet}>
          <div className={s.detailTweetHead}>
            {detail.sourcePost.authorName ? <strong>{detail.sourcePost.authorName}</strong> : null}
            {detail.sourcePost.authorHandle ? (
              <span className={s.handle}>{withAt(detail.sourcePost.authorHandle)}</span>
            ) : null}
            {detail.sourcePost.url ? (
              <a className={s.detailTweetLink} href={detail.sourcePost.url} target="_blank" rel="noreferrer">
                open ↗
              </a>
            ) : null}
          </div>
          <p className={s.detailTweetText}>{detail.sourcePost.text}</p>
        </div>
      </section>

      {detail.result ? (
        <section className={s.detailSection}>
          <h3 className={s.detailHeading}>Outcome</h3>
          <div className={s.detailKvGrid}>
            <div className={s.detailKv}><span className={s.detailK}>Response</span><span>{detail.result.responseType ?? "—"}</span></div>
            <div className={s.detailKv}><span className={s.detailK}>Decision</span><span>{detail.result.actionState ? prettify(detail.result.actionState) : "—"}</span></div>
            <div className={s.detailKv}><span className={s.detailK}>Ticket</span><span>{detail.result.ticketId ? <code className={s.mono}>{shortId(detail.result.ticketId)}</code> : "—"}</span></div>
          </div>
          {detail.result.publicSummary ? <p className={s.detailSummary}>{detail.result.publicSummary}</p> : null}
          {detail.result.warnings.length > 0 ? (
            <ul className={s.detailWarnings}>
              {detail.result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {detail.tickets.length > 0 ? (
        <section className={s.detailSection}>
          <h3 className={s.detailHeading}>Tickets <span className={s.detailCount}>{detail.tickets.length}</span></h3>
          <div className={s.detailTickets}>
            {detail.tickets.map((ticket) => (
              <div key={ticket.ticketId} className={s.detailTicket}>
                <div className={s.detailTicketHead}>
                  <span className={s.chipNeutral}>{ticket.venue}</span>
                  <strong className={s.mono}>{ticket.instrument}</strong>
                  <span className={s.sideTag}>{prettify(ticket.side)}</span>
                  <span className={s.detailTicketSize}>{formatUsd(ticket.sizeUsd)}</span>
                  {ticket.job ? <StatusBadge status={ticket.job.status} /> : <span className={s.badge + " " + s.badgeMuted}>no job</span>}
                </div>
                <p className={s.detailTicketThesis}>{ticket.thesis}</p>
                {ticket.job?.failureReason ? <div className={s.detailError}>{ticket.job.failureReason}</div> : null}
                {ticket.job && ticket.job.filledSizeUsd != null ? (
                  <span className={s.fillText}>
                    {formatUsd(ticket.job.filledSizeUsd)} filled
                    {ticket.job.averagePrice != null ? ` @ ${ticket.job.averagePrice}` : ""}
                    {ticket.job.venueOrderId ? ` · order ${shortId(ticket.job.venueOrderId)}` : ""}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={s.detailSection}>
        <h3 className={s.detailHeading}>
          Pipeline <span className={s.detailCount}>{detail.totals.steps} steps</span>
          {detail.totals.failedSteps > 0 ? <span className={s.detailFailCount}>{detail.totals.failedSteps} failed</span> : null}
        </h3>
        {detail.steps.length === 0 ? (
          <EmptyState label="No steps recorded." />
        ) : (
          <ol className={s.stepList}>
            {detail.steps.map((step) => (
              <StepItem key={step.stepId} step={step} />
            ))}
          </ol>
        )}
      </section>

      {detail.modelCalls.length > 0 ? (
        <section className={s.detailSection}>
          <h3 className={s.detailHeading}>
            Model calls <span className={s.detailCount}>{detail.totals.modelCalls}</span>
            <span className={s.detailCost}>{formatUsd(detail.totals.modelCostUsd)} · {formatTokens(detail.totals.tokens)} tok</span>
          </h3>
          <table className={s.table}>
            <thead>
              <tr><th>Purpose</th><th>Model</th><th className={s.num}>Tokens</th><th className={s.num}>Cost</th><th className={s.num}>Latency</th><th>Status</th></tr>
            </thead>
            <tbody>
              {detail.modelCalls.map((call) => (
                <tr key={call.id}>
                  <td>{call.purpose}</td>
                  <td><span className={s.mono}>{call.model}</span></td>
                  <td className={s.num}>{call.totalTokens != null ? formatTokens(call.totalTokens) : "—"}</td>
                  <td className={s.num}>{call.estimatedCostUsd != null ? formatUsd(call.estimatedCostUsd) : "—"}</td>
                  <td className={s.num}>{call.latencyMs != null ? `${call.latencyMs}ms` : "—"}</td>
                  <td><StatusBadge status={call.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function StepItem({ step }: { step: AdminRunStepDetail }) {
  const [open, setOpen] = useState(false);
  const hasBody = step.input != null || step.output != null || (step.thinkingTrace?.length ?? 0) > 0 || step.error != null;
  return (
    <li className={s.stepItem}>
      <button
        type="button"
        className={s.stepHead}
        onClick={() => hasBody && setOpen((value) => !value)}
        aria-expanded={hasBody ? open : undefined}
        disabled={!hasBody}
      >
        <span className={`${s.stepDot} ${stepDotTone(step.status)}`} aria-hidden />
        <span className={s.stepType}>{prettify(step.stepType)}</span>
        <StatusBadge status={step.status} />
        {step.model ? <span className={s.stepModel}>{step.model}</span> : null}
        <span className={s.stepDuration}>{step.durationMs != null ? `${step.durationMs}ms` : "—"}</span>
        {hasBody ? <span className={s.stepCaret} aria-hidden>{open ? "▾" : "▸"}</span> : <span className={s.stepCaret} />}
      </button>
      {open && hasBody ? (
        <div className={s.stepBody}>
          {step.error ? <div className={s.detailError}>{step.error}</div> : null}
          {step.thinkingTrace ? (
            <Disclosure label="Thinking trace">
              <pre className={s.codeBlock}>{step.thinkingTrace}</pre>
            </Disclosure>
          ) : null}
          {step.input != null ? (
            <Disclosure label="Input">
              <pre className={s.codeBlock}>{stringifyJson(step.input)}</pre>
            </Disclosure>
          ) : null}
          {step.output != null ? (
            <Disclosure label="Output" defaultOpen>
              <pre className={s.codeBlock}>{stringifyJson(step.output)}</pre>
            </Disclosure>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Disclosure({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.disclosure}>
      <button type="button" className={s.disclosureHead} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={s.stepCaret} aria-hidden>{open ? "▾" : "▸"}</span>
        {label}
      </button>
      {open ? children : null}
    </div>
  );
}

function stepDotTone(status: string): string {
  if (status === "succeeded") return s.stepDotOk;
  if (status === "failed") return s.stepDotBad;
  if (status === "running" || status === "pending") return s.stepDotWarn;
  return s.stepDotMuted;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "succeeded"
      ? s.badgeOk
      : status === "failed"
        ? s.badgeBad
        : status === "running" || status === "queued"
          ? s.badgeWarn
          : status === "cancelled" || status === "no_job"
            ? s.badgeMuted
            : s.badgeNeutral;
  return <span className={`${s.badge} ${tone}`}>{prettify(status)}</span>;
}

function EmptyState({ label }: { label: string }) {
  return <div className={s.empty}>{label}</div>;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? s.spin : ""}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function formatInt(value: number): string {
  return value.toLocaleString();
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  if (Math.abs(value) >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

function formatRelative(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "just now";
  if (abs < hour) return `${Math.round(abs / minute)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`;
  if (abs < 7 * day) return `${Math.round(abs / day)}d ${suffix}`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortId(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

function prettify(value: string): string {
  return value.replace(/_/g, " ");
}

function withAt(handle: string): string {
  return handle.startsWith("@") ? handle : `@${handle}`;
}
