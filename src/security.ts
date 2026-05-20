import type { IncomingMessage, ServerResponse } from "node:http";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class RateLimitError extends Error {
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class RequestTooLargeError extends Error {
  constructor(message = "Request body is too large") {
    super(message);
    this.name = "RequestTooLargeError";
  }
}

export function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline' 'self'; form-action 'self'; frame-ancestors 'none'");
}

export function requireApiToken(request: IncomingMessage): void {
  const configured = process.env.CASSIE_API_TOKEN;
  if (!configured) {
    throw new UnauthorizedError("CASSIE_API_TOKEN is not configured.");
  }

  const auth = request.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

  if (token !== configured) {
    throw new UnauthorizedError();
  }
}

type RateBucket = {
  count: number;
  resetAt: number;
};

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maxRequests = Number(process.env.CASSIE_RATE_LIMIT_MAX ?? 60),
    private readonly windowMs = Number(process.env.CASSIE_RATE_LIMIT_WINDOW_MS ?? 60_000),
  ) {}

  check(key: string): void {
    const now = Date.now();
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    current.count += 1;
    if (current.count > this.maxRequests) {
      throw new RateLimitError();
    }
  }
}

export function requestKey(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }

  return request.socket.remoteAddress ?? "unknown";
}
