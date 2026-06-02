import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";
import type { TradeTicket } from "../../../../../packages/core/schemas";
import { markUserFacingHyperliquidPositions } from "../../../../../packages/positions/user-facing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }
    const positions = await store.listUserPositions(settings.userId);
    const tickets = new Map(
      (await Promise.all(positions.map((position) => store.getTradeTicket(position.ticketId))))
        .filter((ticket): ticket is TradeTicket => Boolean(ticket))
        .map((ticket) => [ticket.ticketId, ticket]),
    );
    const markedPositions = await markUserFacingHyperliquidPositions(positions, tickets);
    const latestReviews = await Promise.all(markedPositions.map(async (position) => ({
      positionId: position.positionId,
      review: await store.getLatestPositionReview(position.positionId),
    })));
    return NextResponse.json({
      positions: markedPositions,
      latestReviews: Object.fromEntries(latestReviews.map((item) => [item.positionId, item.review ?? null])),
    });
  } catch (error) {
    return apiError(error);
  }
}
