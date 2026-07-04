import {
  ArcTradeRegistry,
  readArcRegistryEnv,
} from "../adapters/arc/registry.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { Position, TradeTicket } from "../core/schemas/index.ts";

// Best-effort on-chain notarization of Cassie's calls in the Arc trade
// registry. Never blocks or fails a trade: callers fire-and-forget, errors
// land in the audit log, and everything no-ops when the registry env is
// absent.

// The preimage of the on-chain ticketHash. Anyone can rebuild this string
// from the ticket shown in the app and keccak256 it to verify the receipt.
export function canonicalTicketSummary(ticket: TradeTicket): string {
  return [
    ticket.runId ?? "",
    ticket.ticketId,
    ticket.venue,
    ticket.instrument,
    ticket.side,
    String(ticket.sizeUsd),
  ].join("|");
}

export function notarizeOpenedPosition(input: {
  store: CassieStore;
  ticket: TradeTicket;
  position: Position;
}): void {
  const { store, ticket, position } = input;
  if (!readArcRegistryEnv() || !ticket.runId) return;
  void (async () => {
    const run = await store.getRun(ticket.runId as string);
    const txHash = await new ArcTradeRegistry().recordCall({
      runId: ticket.runId as string,
      sourceUrl: run?.sourcePost.url ?? "",
      ticketSummary: canonicalTicketSummary(ticket),
      venue: ticket.venue,
      instrument: ticket.instrument,
      side: ticket.side,
      sizeUsd: position.filledSizeUsd,
    });
    await patchPositionArc(store, position.positionId, { openTxHash: txHash });
    await store.audit({
      entityId: position.positionId,
      entityType: "position",
      eventType: "position.arc_recorded",
      message: "Call notarized in the Arc trade registry.",
      data: { txHash, runId: ticket.runId },
    });
  })().catch((error) => auditFailure(store, position.positionId, "open", error));
}

export function notarizeClosedPosition(input: {
  store: CassieStore;
  ticket: TradeTicket;
  position: Position;
  realizedPnlUsd: number;
}): void {
  const { store, ticket, position } = input;
  if (!readArcRegistryEnv() || !ticket.runId) return;
  void (async () => {
    const txHash = await new ArcTradeRegistry().recordClose({
      runId: ticket.runId as string,
      pnlUsd: input.realizedPnlUsd,
    });
    await patchPositionArc(store, position.positionId, { closeTxHash: txHash });
    await store.audit({
      entityId: position.positionId,
      entityType: "position",
      eventType: "position.arc_closed",
      message: "Call outcome sealed in the Arc trade registry.",
      data: { txHash, runId: ticket.runId },
    });
  })().catch((error) => auditFailure(store, position.positionId, "close", error));
}

// Re-reads the position right before writing so a slow chain confirmation
// doesn't roll back fresher marks written in the meantime.
async function patchPositionArc(
  store: CassieStore,
  positionId: string,
  patch: Partial<NonNullable<Position["arc"]>>,
): Promise<void> {
  const fresh = await store.getPosition(positionId);
  if (!fresh) return;
  await store.updatePosition({
    ...fresh,
    arc: { openTxHash: null, closeTxHash: null, ...fresh.arc, ...patch },
  });
}

function auditFailure(
  store: CassieStore,
  positionId: string,
  stage: "open" | "close",
  error: unknown,
): void {
  void store
    .audit({
      entityId: positionId,
      entityType: "position",
      eventType: "position.arc_record_failed",
      message: `Arc registry ${stage} write failed.`,
      data: { error: error instanceof Error ? error.message : String(error) },
    })
    .catch(() => undefined);
}
