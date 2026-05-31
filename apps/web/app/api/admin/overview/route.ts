import { NextResponse } from "next/server";
import { like } from "drizzle-orm";
import { buildAdminData, type AdminWebhookReceipt } from "../../../../../../packages/app/admin-metrics";
import { createCassieDb } from "../../../../../../packages/core/db/client";
import { runtimeState } from "../../../../../../packages/core/db/schema";
import { DrizzleCassieStore } from "../../../../../../packages/core/db/drizzle-store";
import { adminErrorResponse, assertAdminAuthorized } from "../../_lib/admin-auth";

export const runtime = "nodejs";

async function loadWebhookReceipts(): Promise<AdminWebhookReceipt[]> {
  try {
    const db = createCassieDb();
    const rows = await db
      .select({ value: runtimeState.value })
      .from(runtimeState)
      .where(like(runtimeState.key, "x_webhook:%"));
    return rows
      .map((row) => {
        const value = row.value as { receivedAt?: unknown } | null;
        return typeof value?.receivedAt === "string" ? { receivedAt: value.receivedAt } : null;
      })
      .filter((value): value is AdminWebhookReceipt => value != null);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    assertAdminAuthorized(request);

    const store = new DrizzleCassieStore();
    const [snapshot, webhookReceipts] = await Promise.all([
      store.load(),
      loadWebhookReceipts(),
    ]);

    const data = buildAdminData({ snapshot, webhookReceipts });
    return NextResponse.json(data);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
