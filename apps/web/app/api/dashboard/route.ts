import { NextResponse } from "next/server";
import { PrivyAdapter } from "../../../../../packages/adapters/privy";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";
import { buildDashboardPayload } from "../_lib/dashboard-data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const settings = session.settings;
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }

    const dashboard = await buildDashboardPayload(settings, store, new PrivyAdapter());
    return NextResponse.json({ dashboard });
  } catch (error) {
    return apiError(error);
  }
}
