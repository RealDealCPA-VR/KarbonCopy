/**
 * Session validation that is safe to import OUTSIDE the Next request context
 * (e.g. the Socket.IO handshake in server.ts). No "server-only", no next/headers.
 */
import { eq, and, gt, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";

const { users, sessions } = schema;
export const SESSION_COOKIE = "kc_session";

/** Look up an active (non-expired) session's user. Rejects inactive users. */
export async function validateSessionToken(token: string | undefined | null): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0]?.users ?? null;
  if (!user || !user.active) return null;
  return user;
}

/** Parse a single cookie value out of a raw `Cookie:` header. */
export function readCookie(cookieHeader: string | undefined | null, name = SESSION_COOKIE): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/** Best-effort cleanup of expired sessions (call occasionally). */
export async function pruneExpiredSessions(): Promise<void> {
  try {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  } catch {
    /* non-fatal */
  }
}
