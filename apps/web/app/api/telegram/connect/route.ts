import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../../_lib/account";
import { createTelegramConnectSession } from "../../../../../../packages/notifications/telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const session = await createTelegramConnectSession({
      privyUserId: claims.user_id,
      store,
    });
    return NextResponse.json({ telegram: session });
  } catch (error) {
    return apiError(error);
  }
}
