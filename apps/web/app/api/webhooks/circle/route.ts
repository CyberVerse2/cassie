import { NextResponse } from "next/server";
import {
  processCircleNotification,
  verifyCircleSignature,
} from "../../../../../../packages/app/circle-webhook";
import { DrizzleCassieStore } from "../../../../../../packages/core/db/drizzle-store";

export const runtime = "nodejs";

// Receives Circle webhook notifications for inbound USDC and credits deposits
// in real time. The poller (poll_deposits cron) remains as a backstop.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("X-Circle-Signature");
  const keyId = request.headers.get("X-Circle-Key-Id");

  try {
    const verified = await verifyCircleSignature({ rawBody, signature, keyId });
    if (!verified) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }

    const payload = rawBody ? JSON.parse(rawBody) : null;
    const store = new DrizzleCassieStore();
    const result = await processCircleNotification({ store, payload });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("circle.webhook.error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
