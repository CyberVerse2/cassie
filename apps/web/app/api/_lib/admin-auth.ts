import { NextResponse } from "next/server";
import { optionalEnv } from "../../../../../packages/core/config";

export class AdminAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export function assertAdminAuthorized(request: Request): void {
  const expected = optionalEnv("CASSIE_ADMIN_TOKEN");
  if (!expected) {
    throw new AdminAuthError("Admin dashboard is not configured. Set CASSIE_ADMIN_TOKEN.", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const provided = bearer ?? request.headers.get("x-admin-token")?.trim() ?? null;
  if (!provided || provided !== expected) {
    throw new AdminAuthError("Invalid admin token.", 401);
  }
}

export function adminErrorResponse(error: unknown): NextResponse {
  if (error instanceof AdminAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 400 });
}
