import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { buildTicketDetail } from "../../../../../../../packages/app/admin-metrics";
import { createCassieDb } from "../../../../../../../packages/core/db/client";
import {
  controlRuns,
  executionJobs,
  positions,
  tradeTickets,
} from "../../../../../../../packages/core/db/schema";
import { adminErrorResponse, assertAdminAuthorized } from "../../../_lib/admin-auth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  try {
    assertAdminAuthorized(request);
    const { ticketId } = await context.params;

    const db = createCassieDb();
    const [ticketRows, jobRows, positionRows] = await Promise.all([
      db.select().from(tradeTickets).where(eq(tradeTickets.ticketId, ticketId)).limit(1),
      db.select().from(executionJobs).where(eq(executionJobs.ticketId, ticketId)),
      db.select().from(positions).where(eq(positions.ticketId, ticketId)),
    ]);

    const ticket = ticketRows[0]?.ticket ?? null;
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    const runRows = ticket.runId
      ? await db.select().from(controlRuns).where(eq(controlRuns.runId, ticket.runId)).limit(1)
      : [];

    return NextResponse.json(buildTicketDetail({
      ticket,
      jobs: jobRows.map((row) => row.job),
      positions: positionRows.map((row) => row.position),
      run: runRows[0] ? { ...runRows[0], result: runRows[0].result ?? null } : null,
    }));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
