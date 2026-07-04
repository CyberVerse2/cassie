import { NextResponse } from "next/server";
import { apiError, authenticatedContext } from "../../_lib/account";
import { buildLiveRuns } from "../../_lib/live-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-sent events: streams the user's live pipeline runs to the dashboard.
// The worker persists each step as it executes; this route watches the store
// and pushes a fresh snapshot whenever it changes, so a user coming back
// from X watches their tag run in real time. Polls fast while a run is in
// flight, lazily when idle.
const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 6000;

export async function GET(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    if (!session.settings) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    const userId = session.userId;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let lastJson = "";
        const send = (chunk: string): boolean => {
          try {
            controller.enqueue(encoder.encode(chunk));
            return true;
          } catch {
            return false;
          }
        };

        while (!request.signal.aborted) {
          let hasActiveRun = false;
          try {
            const payload = await buildLiveRuns(store, userId);
            hasActiveRun = payload.runs.some((run) => run.status === "running");
            const json = JSON.stringify(payload);
            const chunk =
              json === lastJson ? ": ping\n\n" : `data: ${json}\n\n`;
            lastJson = json;
            if (!send(chunk)) break;
          } catch {
            // Transient store hiccups: keep the stream alive and retry.
            if (!send(": ping\n\n")) break;
          }
          await sleep(hasActiveRun ? ACTIVE_POLL_MS : IDLE_POLL_MS);
        }
        try {
          controller.close();
        } catch {
          // Already closed by the aborted request.
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
