import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../../_lib/account";
import { createTelegramConnectSession } from "../../../../../../packages/notifications/telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const connectSession = await createTelegramConnectSession({
      userId: session.userId,
      store,
    });
    return NextResponse.json({ telegram: connectSession });
  } catch (error) {
    return apiError(error);
  }
}
