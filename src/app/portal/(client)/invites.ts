import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";

const { portalUsers, contacts } = schema;

const INVITE_DAYS = 14;

export type CreateInviteResult =
  | { ok: true; inviteToken: string; inviteUrl: string; expiresAt: Date; portalUserId: string }
  | { ok: false; error: string };

/**
 * Provision (or re-provision) a portal user for a contact and mint a fresh
 * one-time invite token. This is a PLAIN server function (NOT a "use server"
 * action) so it is callable only from trusted server code — the staff caller
 * (a staff-gated server action or API route) is responsible for its own
 * requireRole(...)/requireWrite() check before invoking this. It is deliberately
 * not exposed as a client-callable action endpoint.
 *
 * - Requires the contact to have an email (the portal login identity).
 * - Idempotent: reuses an existing portalUser for the contact, just rotating
 *   the invite token and re-activating it.
 * - Flips contacts.portalEnabled = true.
 *
 * The returned inviteUrl is a relative path; the staff caller prepends the
 * firm's public portal origin when emailing the invite.
 */
export async function createPortalInvite(contactId: string): Promise<CreateInviteResult> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact || contact.deletedAt) return { ok: false, error: "Contact not found." };
  const email = (contact.email ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "This contact has no email address to invite." };
  }

  const inviteToken = nanoid(32);
  const inviteExpiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000);

  const [existing] = await db
    .select()
    .from(portalUsers)
    .where(eq(portalUsers.contactId, contactId))
    .limit(1);

  let portalUserId: string;
  if (existing) {
    await db
      .update(portalUsers)
      .set({ email, active: true, inviteToken, inviteExpiresAt })
      .where(eq(portalUsers.id, existing.id));
    portalUserId = existing.id;
  } else {
    const [created] = await db
      .insert(portalUsers)
      .values({ contactId, email, active: true, inviteToken, inviteExpiresAt })
      .returning();
    portalUserId = created.id;
  }

  await db.update(contacts).set({ portalEnabled: true }).where(eq(contacts.id, contactId));

  return {
    ok: true,
    portalUserId,
    inviteToken,
    inviteUrl: `/portal/login/accept?token=${inviteToken}`,
    expiresAt: inviteExpiresAt,
  };
}
