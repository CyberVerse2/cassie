import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../../../_lib/account";
import { queueClosePosition } from "../../../../../../../packages/positions/close";
import { decoratePosition } from "../../_lib/position-response";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ positionId: string }> },
) {
  try {
    const { positionId } = await context.params;
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }
    const position = await store.getPosition(positionId);
    if (!position || position.userId !== settings.userId) {
      return NextResponse.json({ error: "Position was not found." }, { status: 404 });
    }
    const updated = await queueClosePosition({ positionId, store });
    const ticket = await store.getTradeTicket(updated.ticketId);
    return NextResponse.json({ position: decoratePosition(updated, ticket ?? undefined) });
  } catch (error) {
    return apiError(error);
  }
}
