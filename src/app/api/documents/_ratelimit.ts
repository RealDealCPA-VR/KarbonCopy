import "server-only";
import type { NextRequest } from "next/server";

/**
 * Tiny dependency-free, in-memory fixed-window rate limiter.
 *
 * Suited to a single-process self-hosted deployment (matches the better-sqlite3
 * single-node assumption elsewhere). State lives in a module-level Map and is
 * reused across HMR reloads via globalThis. Not a substitute for a shared store
 * in a multi-instance deployment.
 */

type Bucket = { count: number; resetAt: number };

const globalForRL = globalThis as unknown as { __rateLimit?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = globalForRL.__rateLimit ?? new Map();
if (process.env.NODE_ENV !== "production") globalForRL.__rateLimit = buckets;

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfter: number;
};

/**
 * Consume one hit for `key`. Returns ok=false once `limit` is exceeded within
 * `windowMs`. Fixed-window: the counter resets wholesale at window expiry.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

/** Best-effort client IP from proxy headers, falling back to the socket. */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// Opportunistic cleanup so the Map can't grow unbounded over a long uptime.
const SWEEP_EVERY = 5 * 60_000;
let lastSweep = Date.now();
function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}

/** Convenience: rate-limit and sweep in one call. */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  maybeSweep();
  return rateLimit(key, limit, windowMs);
}
