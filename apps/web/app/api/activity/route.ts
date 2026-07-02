import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";
import { buildUserActivity, DASHBOARD_ACTIVITY_LIMIT } from "../_lib/dashboard-data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const settings = session.settings;
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }

    const [dashboardData, depositCredits] = await Promise.all([
      store.loadUserDashboardData(settings.userId, { activityLimit: DASHBOARD_ACTIVITY_LIMIT }),
      store.listUserDepositCredits(settings.userId),
    ]);
    return NextResponse.json({ activity: buildUserActivity(settings.userId, dashboardData, depositCredits) });
  } catch (error) {
    return apiError(error);
  }
}
