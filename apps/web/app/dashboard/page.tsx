const tickets = [
  {
    id: "TCK-1042",
    venue: "Polymarket",
    expression: "SOL ETF approval by quarter end",
    confidence: "82%",
  },
  {
    id: "TCK-1041",
    venue: "Hyperliquid",
    expression: "ETH momentum continuation",
    confidence: "76%",
  },
  {
    id: "TCK-1040",
    venue: "Polymarket",
    expression: "Fed cut before September meeting",
    confidence: "73%",
  },
];

export default function DashboardPage() {
  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="section-label">Dashboard</p>
          <h1>Pending trade tickets</h1>
        </div>
        <a className="secondary-action" href="/">
          Back home
        </a>
      </header>

      <section className="ticket-table" aria-label="Pending tickets">
        <div className="table-row table-heading">
          <span>Ticket</span>
          <span>Venue</span>
          <span>Expression</span>
          <span>Confidence</span>
        </div>
        {tickets.map((ticket) => (
          <div className="table-row" key={ticket.id}>
            <strong>{ticket.id}</strong>
            <span>{ticket.venue}</span>
            <span>{ticket.expression}</span>
            <span>{ticket.confidence}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
