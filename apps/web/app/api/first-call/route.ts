import { NextResponse } from "next/server";
import { DrizzleCassieStore } from "../../../../../packages/core/db/drizzle-store";
import { buildLiveFirstCallScenarios } from "../_lib/first-call-live";

export const runtime = "nodejs";

// Public: the intro replays trades already public on the tape and on X.
export async function GET() {
  try {
    const scenarios = await buildLiveFirstCallScenarios(
      new DrizzleCassieStore(),
    );
    return NextResponse.json(
      { scenarios },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
