"use server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { checkRateLimit } from "@/app/api/documents/_ratelimit";

// Brute-force guard: fixed window per email+IP. Reuses the dependency-free,
// in-memory limiter (single-process self-hosted deployment).
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 10 * 60_000; // 10 minutes

/** Best-effort client IP from proxy headers (server actions have no NextRequest). */
async function loginClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

export async function loginAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const ip = await loginClientIp();
  const limit = checkRateLimit(`login:${email}:${ip}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!limit.ok) {
    const mins = Math.ceil(limit.retryAfter / 60);
    return { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid credentials." };
  }
  await createSession(user.id);
  return {};
}
