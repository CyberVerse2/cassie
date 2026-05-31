import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }
    const positions = await store.listUserPositions(settings.userId);
    const latestReviews = await Promise.all(positions.map(async (position) => ({
      positionId: position.positionId,
      review: await store.getLatestPositionReview(position.positionId),
    })));
    return NextResponse.json({
      positions,
      latestReviews: Object.fromEntries(latestReviews.map((item) => [item.positionId, item.review ?? null])),
    });
  } catch (error) {
    return apiError(error);
  }
}
