import { NextResponse } from "next/server";
import { DrizzleCassieStore } from "../../../../../../../packages/core/db/drizzle-store";
import { HyperliquidPositionMarkProvider } from "../../../../../../../packages/positions/marks";
import { applyPositionMark } from "../../../../../../../packages/positions/review";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ positionId: string }> },
) {
  const { positionId } = await context.params;
  const store = new DrizzleCassieStore();
  const position = await store.getPosition(positionId);
  if (!position) {
    return NextResponse.json({ error: "Trade position was not found." }, { status: 404 });
  }

  const ticket = await store.getTradeTicket(position.ticketId);
  if (!ticket) {
    return NextResponse.json({ error: "Trade ticket was not found." }, { status: 404 });
  }

  if (position.venue !== "hyperliquid" || position.status !== "open") {
    return NextResponse.json({ position });
  }

  const mark = await new HyperliquidPositionMarkProvider().markPosition({ position, ticket });
  return NextResponse.json({
    position: applyPositionMark(position, mark.markPrice, mark.currentValueUsd, mark.markedAt),
  });
}
