/**
 * Lightweight local auth: scrypt password hashing + cookie sessions.
 * Suited to a self-hosted LAN app (no external IdP, no native bcrypt build).
 */
import "server-only";
import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { nanoid } from "nanoid";
import type { User, UserRole } from "@/db/schema";

export { hashPassword, verifyPassword } from "@/lib/password";
import { verifyPassword } from "@/lib/password";

const { users, sessions } = schema;
const COOKIE = "kc_session";
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
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.users ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

const RANK: Record<UserRole, number> = { readonly: 0, staff: 1, manager: 2, admin: 3, owner: 4 };
export function hasRole(user: User, min: UserRole): boolean {
  return RANK[user.role] >= RANK[min];
}
