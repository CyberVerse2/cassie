import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";
import { decoratePosition } from "./_lib/position-response";

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
      (await store.getTradeTickets(positions.map((position) => position.ticketId)))
        .map((ticket) => [ticket.ticketId, ticket]),
    );
    const displayPositions = positions.map((position) =>
      decoratePosition(position, tickets.get(position.ticketId))
    );
    const latestReviewRows = await store.getLatestPositionReviews(positions.map((position) => position.positionId));
    const latestReviews = new Map(latestReviewRows.map((review) => [review.positionId, review]));
    return NextResponse.json({
      positions: displayPositions,
      latestReviews: Object.fromEntries(positions.map((position) => [
        position.positionId,
        latestReviews.get(position.positionId) ?? null,
      ])),
    });
  } catch (error) {
    return apiError(error);
  }
}
