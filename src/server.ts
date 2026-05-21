import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CassieProduct, MentionRequestSchema, SettingsRequestSchema } from "../packages/workflows/product.ts";
import { renderDashboard } from "./dashboard.ts";
import { assertRuntimeConfig } from "./config.ts";
import {
  MemoryRateLimiter,
  RequestTooLargeError,
  UnauthorizedError,
  applySecurityHeaders,
  requestKey,
  requireApiToken,
} from "./security.ts";
import { XWebhookPayloadSchema, crcResponse, xEventToMention } from "../packages/workflows/x-webhook.ts";

assertRuntimeConfig();
const product = new CassieProduct();
const port = Number(process.env.PORT ?? 3000);
const rateLimiter = new MemoryRateLimiter();

const server = createServer(async (request, response) => {
  try {
    applySecurityHeaders(response);
    rateLimiter.check(requestKey(request));
    await route(request, response);
  } catch (error) {
    const status = error instanceof UnauthorizedError
      ? 401
      : error instanceof RequestTooLargeError
        ? 413
        : error instanceof Error && error.name === "RateLimitError"
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

  if (request.method === "GET" && url.pathname === "/api/x/webhook") {
    const crcToken = url.searchParams.get("crc_token");
    if (!crcToken) {
      sendJson(response, 400, { error: "Missing crc_token" });
      return;
    }
    sendJson(response, 200, crcResponse(crcToken));
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard") {
    requireApiToken(request);
    const state = await product.state();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderDashboard(state));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    requireApiToken(request);
    sendJson(response, 200, await product.state());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    requireApiToken(request);
    const body = SettingsRequestSchema.parse(await readJson(request));
    sendJson(response, 200, await product.upsertSettings(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/mentions") {
    requireApiToken(request);
    const body = MentionRequestSchema.parse(await readJson(request));
    sendJson(response, 202, await product.createMentionRun(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/x/webhook") {
    requireApiToken(request);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      sendJson(response, 400, { error: "Missing userId" });
      return;
    }

    const body = XWebhookPayloadSchema.parse(await readJson(request));
    const results = [];
    for (const event of body.tweet_create_events) {
      results.push(await product.createMentionRun(xEventToMention(event, userId)));
    }
    sendJson(response, 202, { queued: results.length, results });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/x/poll") {
    requireApiToken(request);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      sendJson(response, 400, { error: "Missing userId" });
      return;
    }

    sendJson(response, 200, await product.pollXMentions(userId));
    return;
  }

  const approveMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/approve$/);
  if (request.method === "POST" && approveMatch) {
    requireApiToken(request);
    const result = await product.approveTicket(approveMatch[1] as string);

    if (request.headers["content-type"]?.includes("application/json")) {
      sendJson(response, 200, result);
      return;
    }

    response.writeHead(303, { Location: "/dashboard" });
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/execution/process") {
    requireApiToken(request);
    sendJson(response, 200, await product.processNextExecutionJob());
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  const maxBytes = Number(process.env.CASSIE_MAX_BODY_BYTES ?? 256_000);
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new RequestTooLargeError();
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}
