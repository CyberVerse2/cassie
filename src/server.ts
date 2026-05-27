import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CassieProduct } from "../packages/app/product.ts";
import { assertRuntimeConfig, config } from "../packages/core/config.ts";
import { renderDashboard, renderDashboardScript } from "./dashboard.ts";
import {
  MemoryRateLimiter,
  RateLimitError,
  applySecurityHeaders,
  requestKey,
} from "./security.ts";

assertRuntimeConfig();
const product = new CassieProduct();
const port = config.http.port;
const rateLimiter = new MemoryRateLimiter();

const server = createServer(async (request, response) => {
  try {
    applySecurityHeaders(response);
    rateLimiter.check(requestKey(request));
    await route(request, response);
  } catch (error) {
    const status = error instanceof RateLimitError
        ? 429
        : 500;
    sendJson(response, status, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, () => {
  console.log(`Cassie listening on http://localhost:${port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(302, { Location: "/dashboard" });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard") {
    const state = await product.state();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderDashboard(state, {
      query: url.searchParams.get("q"),
      status: url.searchParams.get("status"),
      model: url.searchParams.get("model"),
      selectedRunId: url.searchParams.get("run"),
      refreshSeconds: numberFromQuery(url.searchParams.get("refresh")),
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    response.end(renderDashboardScript());
    return;
  }

  const runJsonMatch = url.pathname.match(/^\/dashboard\/runs\/([^/]+)\.json$/);
  if (request.method === "GET" && runJsonMatch) {
    const state = await product.state();
    const runId = decodeURIComponent(runJsonMatch[1] as string);
    const run = state.controlRuns.find((candidate) => candidate.runId === runId);
    if (!run) {
      sendJson(response, 404, { error: "Run not found" });
      return;
    }
    sendJson(response, 200, {
      run,
      steps: state.runSteps.filter((step) => step.runId === runId),
      modelCallUsage: state.modelCallUsage.filter((record) => record.controlRunId === runId),
      tickets: state.tradeTickets.filter((ticket) => ticket.runId === runId),
      auditEvents: state.auditEvents.filter((event) => event.entityId === runId),
    });
    return;
  }

  const approveMatch = url.pathname.match(/^\/tickets\/([^/]+)\/approve$/);
  if (request.method === "POST" && approveMatch) {
    const result = await product.approveTicket(approveMatch[1] as string);

    if (request.headers["content-type"]?.includes("application/json")) {
      sendJson(response, 200, result);
      return;
    }

    response.writeHead(303, { Location: "/dashboard" });
    response.end();
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function numberFromQuery(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}
