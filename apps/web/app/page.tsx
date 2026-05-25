const runs = [
  { label: "Queued mentions", value: "18", tone: "steady" },
  { label: "Pending tickets", value: "4", tone: "warm" },
  { label: "Execution audits", value: "129", tone: "cool" },
];

const timeline = [
  "Mention captured from X",
  "Supervisor framed opportunity",
  "Venue candidates ranked",
  "Ticket waiting for approval",
];

export default function Home() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="section-label">Cassie Control</p>
          <h1 id="page-title">Trade expression review, without the fog.</h1>
          <p className="lede">
            A production-ready Next.js surface for reviewing Cassie runs,
            pending tickets, and execution audit trails.
          </p>
        </div>
        <a className="primary-action" href="/dashboard">
          Open dashboard
        </a>
      </section>

      <section className="metric-grid" aria-label="Current Cassie activity">
        {runs.map((run) => (
          <article className={`metric metric-${run.tone}`} key={run.label}>
            <p>{run.label}</p>
            <strong>{run.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace" aria-label="Supervisor timeline preview">
        <div>
          <p className="section-label">Supervisor Loop</p>
          <h2>Every decision stays visible.</h2>
        </div>
        <ol>
          {timeline.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
