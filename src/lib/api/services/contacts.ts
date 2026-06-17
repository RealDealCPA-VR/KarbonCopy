/**
 * Contacts service — mirrors the organizations exemplar.
 * Pure: explicit actor, RBAC, zod validation, activity logging, plain returns.
 */
import { z } from "zod";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import { db, schema, type Actor, requireWrite, requireManager, parse, logActivity, pagination } from "./_base";
import { notFound, validation } from "@/lib/api/errors";
import { createPortalInvite } from "@/app/portal/(client)/invites";

const { contacts, organizations, users, portalUsers, portalSessions } = schema;

const createInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  title: z.string().trim().max(120).optional(),
  organizationId: z.string().trim().min(1).optional(),
  isPrimary: z.boolean().default(false),
  portalEnabled: z.boolean().default(false),
  notes: z.string().max(5000).optional(),
  ownerId: z.string().trim().min(1).optional(),
});
const updateInput = createInput.partial();

const listInput = pagination.extend({
  organizationId: z.string().trim().min(1).optional(),
});

function present(c: typeof contacts.$inferSelect) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    title: c.title,
    organizationId: c.organizationId,
    isPrimary: c.isPrimary,
    portalEnabled: c.portalEnabled,
    notes: c.notes,
    ownerId: c.ownerId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function assertOrgExists(organizationId: string) {
  const [org] = await db
    .select({ id: organizations.id, deletedAt: organizations.deletedAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org || org.deletedAt) throw validation(`Organization ${organizationId} not found`);
}

async function assertUser(userId: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw validation(`User ${userId} not found`);
}

/** Deactivate any portal user for this contact and drop their sessions. */
async function revokePortalAccess(contactId: string) {
  const pus = await db.select({ id: portalUsers.id }).from(portalUsers).where(eq(portalUsers.contactId, contactId));
  for (const pu of pus) {
    await db.update(portalUsers).set({ active: false, inviteToken: null, inviteExpiresAt: null }).where(eq(portalUsers.id, pu.id));
    await db.delete(portalSessions).where(eq(portalSessions.portalUserId, pu.id));
  }
}

export async function listContacts(actor: Actor, input: unknown = {}) {
  const { limit, offset, search, organizationId } = parse(listInput, input);
  const where = and(
    isNull(contacts.deletedAt),
    organizationId ? eq(contacts.organizationId, organizationId) : undefined,
    search
      ? or(
          like(contacts.firstName, `%${search}%`),
          like(contacts.lastName, `%${search}%`),
          like(contacts.email, `%${search}%`),
        )
      : undefined,
  );
  const rows = await db
    .select()
    .from(contacts)
    .where(where)
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(present);
}

export async function getContact(actor: Actor, id: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c || c.deletedAt) throw notFound("Contact");
  return present(c);
}

export async function createContact(actor: Actor, input: unknown) {
  requireWrite(actor);
  const data = parse(createInput, input);
  if (data.organizationId) await assertOrgExists(data.organizationId);
  if (data.ownerId) await assertUser(data.ownerId);
  // Portal access needs an email (the login identity) and provisioning below.
  if (data.portalEnabled && !(data.email && data.email.trim())) {
    throw validation("A contact email is required to enable portal access.");
  }
  const [row] = await db
    .insert(contacts)
    .values({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || null,
      phone: data.phone || null,
      title: data.title || null,
      organizationId: data.organizationId || null,
      isPrimary: data.isPrimary,
      portalEnabled: data.portalEnabled,
      notes: data.notes || null,
      ownerId: data.ownerId || null,
    })
    .returning();
  if (!row) throw notFound("Contact");
  // Provision the portalUser + invite token so the flag actually grants access.
  if (data.portalEnabled) {
    const invite = await createPortalInvite(row.id);
    if (!invite.ok) throw validation(invite.error);
  }
  await logActivity({
    actorId: actor.id,
    verb: "created",
    entityKind: "contact",
    entityId: row.id,
    summary: `${actor.name} created contact ${row.firstName} ${row.lastName} (via API)`,
  });
  return present(row);
}

export async function updateContact(actor: Actor, id: string, input: unknown) {
  requireWrite(actor);
  const data = parse(updateInput, input);
  const [existing] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!existing || existing.deletedAt) throw notFound("Contact");
  if (data.organizationId) await assertOrgExists(data.organizationId);
  if (data.ownerId) await assertUser(data.ownerId);

  const enabling = data.portalEnabled === true && !existing.portalEnabled;
  const disabling = data.portalEnabled === false && existing.portalEnabled;
  if (enabling) {
    const emailAfter = data.email !== undefined ? data.email : existing.email;
    if (!(emailAfter && emailAfter.trim())) {
      throw validation("A contact email is required to enable portal access.");
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["firstName", "lastName", "email", "phone", "title", "organizationId", "isPrimary", "portalEnabled", "notes", "ownerId"] as const) {
    if (data[k] !== undefined) patch[k] = data[k] === "" ? null : data[k];
  }
  const [row] = await db.update(contacts).set(patch).where(eq(contacts.id, id)).returning();
  if (!row) throw notFound("Contact");

  // Keep portal provisioning in step with the flag (createPortalInvite also
  // re-sets portalEnabled=true; revokePortalAccess tears the session down).
  if (enabling) {
    const invite = await createPortalInvite(row.id);
    if (!invite.ok) throw validation(invite.error);
  } else if (disabling) {
    await revokePortalAccess(row.id);
  }

  await logActivity({
    actorId: actor.id, verb: "updated", entityKind: "contact", entityId: id,
    summary: `${actor.name} updated contact ${row.firstName} ${row.lastName} (via API)`,
  });
  return present(row);
}

export async function deleteContact(actor: Actor, id: string) {
  requireManager(actor);
  const [existing] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!existing || existing.deletedAt) throw notFound("Contact");
  await db.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, id));
  await logActivity({
    actorId: actor.id, verb: "deleted", entityKind: "contact", entityId: id,
    summary: `${actor.name} deleted contact ${existing.firstName} ${existing.lastName} (via API)`,
  });
  return { id, deleted: true as const };
}
