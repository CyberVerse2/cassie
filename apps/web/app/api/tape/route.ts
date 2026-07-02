import { NextResponse } from "next/server";
import { DrizzleCassieStore } from "../../../../../packages/core/db/drizzle-store";
import { buildGlobalTape } from "../_lib/tape-data";

export const runtime = "nodejs";

// Public: the tape shows calls already made publicly by tagging
// @cassiedottrade on X, so it needs no session.
export async function GET() {
  try {
    const calls = await buildGlobalTape(new DrizzleCassieStore());
    return NextResponse.json(
      { calls },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
