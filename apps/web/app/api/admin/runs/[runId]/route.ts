import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { buildRunDetail } from "../../../../../../../packages/app/admin-metrics";
import { createCassieDb } from "../../../../../../../packages/core/db/client";
import {
  controlRuns,
  executionJobs,
  modelCallUsage,
  positions,
  runSteps,
  tradeTickets,
} from "../../../../../../../packages/core/db/schema";
import { adminErrorResponse, assertAdminAuthorized } from "../../../_lib/admin-auth";
import { CassieProduct } from "../../../../../../../packages/app/product";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    assertAdminAuthorized(request);
    const { runId } = await context.params;
    const result = await new CassieProduct().rerunRun(runId);
    return NextResponse.json(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    assertAdminAuthorized(request);
    const { runId } = await context.params;

    const db = createCassieDb();
    const [runRows, stepRows, ticketRows, modelRows] = await Promise.all([
      db.select().from(controlRuns).where(eq(controlRuns.runId, runId)).limit(1),
      db.select().from(runSteps).where(eq(runSteps.runId, runId)),
      db.select().from(tradeTickets).where(eq(tradeTickets.runId, runId)),
      db.select().from(modelCallUsage).where(eq(modelCallUsage.controlRunId, runId)),
    ]);

    const runRow = runRows[0];
    if (!runRow) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    const tickets = ticketRows.map((row) => row.ticket);
    const ticketIds = tickets.map((ticket) => ticket.ticketId);
    const jobRows = ticketIds.length
      ? await db.select().from(executionJobs).where(inArray(executionJobs.ticketId, ticketIds))
      : [];
    const positionRows = ticketIds.length
      ? await db.select().from(positions).where(inArray(positions.ticketId, ticketIds))
      : [];

    const detail = buildRunDetail({
      run: { ...runRow, result: runRow.result ?? null },
      steps: stepRows.map((row) => ({
        ...row,
        input: row.input ?? null,
        output: row.output ?? null,
        thinkingTrace: row.thinkingTrace ?? null,
      })),
      tickets,
      jobs: jobRows.map((row) => row.job),
      positions: positionRows.map((row) => row.position),
      modelCalls: modelRows.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        provider: row.provider,
        model: row.model,
        totalTokens: row.totalTokens ?? null,
        estimatedCostUsd: row.estimatedCostUsd ?? null,
        latencyMs: row.latencyMs ?? null,
        status: row.status,
        error: row.error ?? null,
        createdAt: row.createdAt,
      })),
    });

    return NextResponse.json(detail);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
