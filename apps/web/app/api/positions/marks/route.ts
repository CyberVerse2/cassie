import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  authenticatedContext,
} from "../../_lib/account";
import type { Position } from "../../../../../../packages/core/schemas";
import { markUserFacingHyperliquidPositions } from "../../../../../../packages/positions/user-facing";
import { decoratePosition } from "../_lib/position-response";

export const runtime = "nodejs";

const PositionMarksRequestSchema = z.object({
  positionIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  try {
    const body = PositionMarksRequestSchema.parse(await request.json());
    const { session, store } = await authenticatedContext(request);
    const settings = session.settings;
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }

    const positions = (await Promise.all(body.positionIds.map((positionId) => store.getPosition(positionId))))
      .filter((position): position is Position => {
        if (!position) return false;
        return position.userId === settings.userId
          && position.status === "open"
          && position.venue === "hyperliquid";
      });
    const tickets = new Map(
      (await store.getTradeTickets(positions.map((position) => position.ticketId)))
        .map((ticket) => [ticket.ticketId, ticket]),
    );
    const markedPositions = await markUserFacingHyperliquidPositions(positions, tickets);

    return NextResponse.json({
      positions: markedPositions.map((position) =>
        decoratePosition(position, tickets.get(position.ticketId))
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
