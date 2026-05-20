import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CassieProduct, MentionRequestSchema, SettingsRequestSchema } from "./product.js";
import { renderDashboard } from "./dashboard.js";

const product = new CassieProduct();
const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
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
    response.end(renderDashboard(state));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, await product.state());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const body = SettingsRequestSchema.parse(await readJson(request));
    sendJson(response, 200, await product.upsertSettings(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/mentions") {
    const body = MentionRequestSchema.parse(await readJson(request));
    sendJson(response, 200, await product.processMention(body));
    return;
  }

  const approveMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/approve$/);
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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}
