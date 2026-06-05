import { NextResponse } from "next/server";
import {
  apiError,
  authenticatedContext,
} from "../_lib/account";
import { buildUserActivity, DASHBOARD_ACTIVITY_LIMIT } from "../_lib/dashboard-data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      return NextResponse.json({ error: "Cassie account was not found." }, { status: 404 });
    }

    const dashboardData = await store.loadUserDashboardData(settings.userId, { activityLimit: DASHBOARD_ACTIVITY_LIMIT });
    return NextResponse.json({ activity: buildUserActivity(settings.userId, dashboardData) });
  } catch (error) {
    return apiError(error);
  }
}
