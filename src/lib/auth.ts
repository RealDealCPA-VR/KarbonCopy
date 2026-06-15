/**
 * Lightweight local auth: scrypt password hashing + cookie sessions.
 * Suited to a self-hosted LAN app (no external IdP, no native bcrypt build).
 */
import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nanoid } from "nanoid";
import type { User, UserRole } from "@/db/schema";
import { validateSessionToken, SESSION_COOKIE } from "@/lib/session";

export { hashPassword, verifyPassword } from "@/lib/password";

const { users, sessions } = schema;
const COOKIE = SESSION_COOKIE;
const SESSION_DAYS = 30;

export async function createSession(userId: string) {
  const token = nanoid(40);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ userId, token, expiresAt });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.token, token));
  jar.delete(COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  return validateSessionToken(jar.get(COOKIE)?.value);
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export { hasRole } from "@/lib/rbac";
import { hasRole } from "@/lib/rbac";

/**
 * Authorize the current user to at least `min`. Throws FORBIDDEN otherwise.
 * Use in every mutating server action / privileged API route.
 */
export async function requireRole(min: UserRole): Promise<User> {
  const user = await requireUser();
  if (!hasRole(user, min)) throw new Error("FORBIDDEN");
  return user;
}

/** Any write/create/update — blocks read-only users. */
export const requireWrite = () => requireRole("staff");
/** Destructive (delete/archive) or sensitive ops. */
export const requireManager = () => requireRole("manager");
/** Admin/owner-only (settings, users, automators). */
export const requireAdmin = () => requireRole("admin");

/** Invalidate all of a user's sessions (call on role/active/password change). */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
