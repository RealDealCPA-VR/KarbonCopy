/**
 * Client-portal session layer — the second auth realm.
 *
 * This is the `kc_portal` analogue of lib/auth.ts (which is staff-only and uses
 * `kc_session`). Portal code MUST use these helpers and MUST NEVER call
 * getCurrentUser()/requireUser(): the two realms are deliberately isolated so a
 * client session can never reach staff-only data.
 *
 * A portal user authenticates against `portalUsers` (scrypt password hash) and
 * is always pinned to exactly one `contacts` row, which in turn belongs to one
 * `organizations` row. Every authorize decision in the portal scopes to that
 * organization id — a client may only ever see their own org's data.
 */
import "server-only";
import { cookies } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import type { Contact, Organization, PortalUser } from "@/db/schema";

export { hashPassword, verifyPassword } from "@/lib/password";

const { portalUsers, portalSessions, contacts, organizations } = schema;

export const PORTAL_COOKIE = "kc_portal";
/** Portal sessions are short-lived per the public-surface security invariants. */
const SESSION_DAYS = 7;

/** What a logged-in portal request resolves to. */
export type PortalContext = {
  portalUser: PortalUser;
  contact: Contact;
  /** May be null if the contact has no org — such a user has no scoped data. */
  organization: Organization | null;
};

/**
 * Create a portal session for `portalUserId`, set the `kc_portal` cookie, and
 * stamp lastLoginAt. Mirrors lib/auth.createSession but for the client realm.
 */
export async function createPortalSession(portalUserId: string): Promise<void> {
  const token = nanoid(40);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(portalSessions).values({ portalUserId, token, expiresAt });
  const jar = await cookies();
  jar.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // The portal is internet-facing (served over HTTPS via the tunnel), so the
    // cookie is secure by default. Defaults on in production; opt out only with
    // COOKIE_SECURE=false (e.g. local HTTP testing).
    secure:
      process.env.COOKIE_SECURE === "true" ||
      (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production"),
    path: "/",
    expires: expiresAt,
  });
  await db
    .update(portalUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(portalUsers.id, portalUserId));
}

/** Destroy the current portal session (DB row + cookie). */
export async function destroyPortalSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (token) await db.delete(portalSessions).where(eq(portalSessions.token, token));
  jar.delete(PORTAL_COOKIE);
}

/**
 * Resolve the current portal user (+ contact + organization) from the cookie,
 * or null if there is no valid/active session. Rejects:
 *  - missing/expired session tokens
 *  - inactive portal users (active = false)
 *  - portal users whose contact has been soft-deleted
 */
export async function getPortalUser(): Promise<PortalContext | null> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select()
    .from(portalSessions)
    .innerJoin(portalUsers, eq(portalSessions.portalUserId, portalUsers.id))
    .innerJoin(contacts, eq(portalUsers.contactId, contacts.id))
    .where(and(eq(portalSessions.token, token), gt(portalSessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const portalUser = row.portal_users;
  const contact = row.contacts;
  if (!portalUser.active) return null;
  if (contact.deletedAt) return null;

  let organization: Organization | null = null;
  if (contact.organizationId) {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, contact.organizationId))
      .limit(1);
    // A soft-deleted org is treated as no org (no scoped data).
    organization = org && !org.deletedAt ? org : null;
  }

  return { portalUser, contact, organization };
}

/**
 * Like getPortalUser, but throws "UNAUTHENTICATED" when there is no valid
 * session. Every `(client)` page/action calls this. The portal layout/page
 * catches the throw and redirects to /portal/login.
 */
export async function requirePortalUser(): Promise<PortalContext> {
  const ctx = await getPortalUser();
  if (!ctx) throw new Error("UNAUTHENTICATED");
  return ctx;
}

/** Invalidate every session for a portal user (call on password/active change). */
export async function invalidatePortalSessions(portalUserId: string): Promise<void> {
  await db.delete(portalSessions).where(eq(portalSessions.portalUserId, portalUserId));
}

/** Best-effort cleanup of expired portal sessions. */
export async function pruneExpiredPortalSessions(): Promise<void> {
  try {
    await db.delete(portalSessions).where(lt(portalSessions.expiresAt, new Date()));
  } catch {
    /* non-fatal */
  }
}
