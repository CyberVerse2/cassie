import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const positionId = url.searchParams.get("positionId");
    if (!positionId) {
      return NextResponse.json({ error: "positionId is required." }, { status: 400 });
    }
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }
    const position = await store.getPosition(positionId);
    if (!position || position.userId !== settings.userId) {
      return NextResponse.json({ error: "Position was not found." }, { status: 404 });
    }
    return NextResponse.json({
      reviews: await store.listPositionReviews(positionId),
    });
  } catch (error) {
    return apiError(error);
  }
}
