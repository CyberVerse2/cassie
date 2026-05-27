import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../packages/core/config.ts";

export class RateLimitError extends Error {
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline' 'self'; form-action 'self'; frame-ancestors 'none'");
}

type RateBucket = {
  count: number;
  resetAt: number;
};

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maxRequests = config.http.rateLimitMax,
    private readonly windowMs = config.http.rateLimitWindowMs,
  ) {}

  check(key: string): void {
    const now = Date.now();
    this.pruneExpired(now);

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

  private pruneExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
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
