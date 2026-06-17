"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireWrite, requireManager } from "@/lib/auth";
import { encryptField } from "@/lib/crypto";
import { emitToUser } from "@/server/realtime";
import { createPortalInvite } from "@/app/portal/(client)/invites";
import type { EntityType } from "@/db/schema";

const {
  organizations,
  contacts,
  activities,
  comments,
  notifications,
  customFieldValues,
  portalUsers,
  portalSessions,
} = schema;

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function clean(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/* ------------------------------------------------------------------ */
/* Organizations                                                      */
/* ------------------------------------------------------------------ */

export async function createOrganization(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const name = clean(form.get("name"));
  if (!name) return { ok: false, error: "Name is required." };

  const entityType = (clean(form.get("entityType")) ?? "c_corp") as EntityType;
  const ownerId = clean(form.get("ownerId"));

  // Insert org + activity (+ optional RM notification) atomically.
  let id: string;
  let notification: typeof schema.notifications.$inferSelect | undefined;
  try {
    ({ id, notification } = db.transaction((tx) => {
    const [row] = tx
      .insert(organizations)
      .values({
        name,
        entityType,
        ein: encryptField(clean(form.get("ein"))),
        website: clean(form.get("website")),
        phone: clean(form.get("phone")),
        email: clean(form.get("email")),
        address: clean(form.get("address")),
        fiscalYearEnd: clean(form.get("fiscalYearEnd")),
        notes: clean(form.get("notes")),
        ownerId: ownerId,
        isClient: true,
      })
      .returning({ id: organizations.id })
      .all();
    if (!row) throw new Error("Organization could not be created.");

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "created",
        entityKind: "organization",
        entityId: row.id,
        summary: `${user.name} created client ${name}`,
      })
      .run();

    let notif: typeof schema.notifications.$inferSelect | undefined;
    if (ownerId && ownerId !== user.id) {
      [notif] = tx
        .insert(notifications)
        .values({
          userId: ownerId,
          type: "assignment",
          title: "You're now a relationship manager",
          body: `You were assigned as RM for ${name}.`,
          entityKind: "organization",
          entityId: row.id,
        })
        .returning()
        .all();
    }

    return { id: row.id, notification: notif };
    }));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create client." };
  }

  if (notification) emitToUser(notification.userId, "notification", notification);

  revalidatePath("/clients");
  return { ok: true, data: { id } };
}

export async function updateOrganization(form: FormData): Promise<ActionResult> {
  const user = await requireWrite();
  const id = clean(form.get("id"));
  if (!id) return { ok: false, error: "Missing organization id." };
  const name = clean(form.get("name"));
  if (!name) return { ok: false, error: "Name is required." };

  const ownerId = clean(form.get("ownerId"));

  // Only managers' dialogs include the editable EIN field. When it wasn't
  // editable (einEditable !== "1"), preserve the stored value rather than
  // wiping it; otherwise re-encrypt the submitted cleartext.
  const einEditable = form.get("einEditable") === "1";

  try {
    db.transaction((tx) => {
    tx.update(organizations)
      .set({
        name,
        entityType: (clean(form.get("entityType")) ?? "c_corp") as EntityType,
        ...(einEditable ? { ein: encryptField(clean(form.get("ein"))) } : {}),
        website: clean(form.get("website")),
        phone: clean(form.get("phone")),
        email: clean(form.get("email")),
        address: clean(form.get("address")),
        fiscalYearEnd: clean(form.get("fiscalYearEnd")),
        notes: clean(form.get("notes")),
        ownerId,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .run();

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "updated",
        entityKind: "organization",
        entityId: id,
        summary: `${user.name} updated ${name}`,
      })
      .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update client." };
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

export async function archiveOrganization(id: string): Promise<ActionResult> {
  const user = await requireManager();
  if (!id) return { ok: false, error: "Missing organization id." };

  try {
    db.transaction((tx) => {
    const [org] = tx
      .update(organizations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning({ name: organizations.name })
      .all();

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "archived",
        entityKind: "organization",
        entityId: id,
        summary: `${user.name} archived ${org?.name ?? "a client"}`,
      })
      .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to archive client." };
  }

  revalidatePath("/clients");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Contacts                                                           */
/* ------------------------------------------------------------------ */

export async function upsertContact(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const id = clean(form.get("id"));
  const organizationId = clean(form.get("organizationId"));
  const firstName = clean(form.get("firstName"));
  const lastName = clean(form.get("lastName"));
  if (!firstName || !lastName) return { ok: false, error: "First and last name are required." };

  const isPrimary = form.get("isPrimary") === "on" || form.get("isPrimary") === "true";
  const portalEnabled =
    form.get("portalEnabled") === "on" || form.get("portalEnabled") === "true";

  const values = {
    firstName,
    lastName,
    email: clean(form.get("email")),
    phone: clean(form.get("phone")),
    title: clean(form.get("title")),
    organizationId,
    notes: clean(form.get("notes")),
    isPrimary,
    portalEnabled,
  };

  // Upsert + demote-other-primaries + activity atomically (avoids two-primary races).
  let contactId: string;
  try {
    contactId = db.transaction((tx) => {
    let contactId: string;
    if (id) {
      tx.update(contacts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(contacts.id, id))
        .run();
      contactId = id;
    } else {
      const [row] = tx.insert(contacts).values(values).returning({ id: contacts.id }).all();
      if (!row) throw new Error("Contact could not be created.");
      contactId = row.id;
    }

    // Enforce single primary per org: demote every other contact.
    if (isPrimary && organizationId) {
      tx.update(contacts)
        .set({ isPrimary: false })
        .where(and(eq(contacts.organizationId, organizationId), ne(contacts.id, contactId)))
        .run();
    }

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: id ? "updated" : "created",
        entityKind: "contact",
        entityId: contactId,
        summary: `${user.name} ${id ? "updated" : "added"} contact ${firstName} ${lastName}`,
        meta: organizationId ? { organizationId } : undefined,
      })
      .run();

    return contactId;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save contact." };
  }

  if (organizationId) revalidatePath(`/clients/${organizationId}`);
  revalidatePath("/clients/people");
  return { ok: true, data: { id: contactId } };
}

export async function toggleContactPortal(
  id: string,
  enabled: boolean,
): Promise<ActionResult<{ inviteUrl: string; expiresAt: Date }>> {
  const user = await requireWrite();

  let contact;
  try {
    [contact] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load contact." };
  }
  if (!contact || contact.deletedAt) return { ok: false, error: "Contact not found." };
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();

  if (enabled) {
    try {
      // Provision the portalUser + mint a one-time invite token (also flips
      // portalEnabled=true). Without this the contact could never actually log in.
      const invite = await createPortalInvite(id);
      if (!invite.ok) return { ok: false, error: invite.error };
      await db.insert(activities).values({
        actorId: user.id,
        verb: "updated",
        entityKind: "contact",
        entityId: id,
        summary: `${user.name} enabled portal access for ${fullName}`,
      });
      if (contact.organizationId) revalidatePath(`/clients/${contact.organizationId}`);
      revalidatePath("/clients/people");
      const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
      return { ok: true, data: { inviteUrl: `${base}${invite.inviteUrl}`, expiresAt: invite.expiresAt } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to enable portal access." };
    }
  }

  // Disable: flip the flag, deactivate the portal user, and drop their sessions
  // so an outstanding cookie/invite can't keep them in.
  try {
    db.transaction((tx) => {
      tx.update(contacts).set({ portalEnabled: false, updatedAt: new Date() }).where(eq(contacts.id, id)).run();
      const pus = tx.select({ id: portalUsers.id }).from(portalUsers).where(eq(portalUsers.contactId, id)).all();
      for (const pu of pus) {
        tx.update(portalUsers).set({ active: false, inviteToken: null, inviteExpiresAt: null }).where(eq(portalUsers.id, pu.id)).run();
        tx.delete(portalSessions).where(eq(portalSessions.portalUserId, pu.id)).run();
      }
      tx.insert(activities).values({
        actorId: user.id,
        verb: "updated",
        entityKind: "contact",
        entityId: id,
        summary: `${user.name} disabled portal access for ${fullName}`,
      }).run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update portal access." };
  }

  if (contact.organizationId) revalidatePath(`/clients/${contact.organizationId}`);
  revalidatePath("/clients/people");
  return { ok: true };
}

export async function deleteContact(id: string): Promise<ActionResult> {
  const user = await requireManager();

  let c: { organizationId: string | null } | null;
  try {
    c = db.transaction((tx) => {
    const [c] = tx
      .update(contacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning({ organizationId: contacts.organizationId })
      .all();

    // No row matched → don't log a phantom deletion activity.
    if (!c) return null;

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "archived",
        entityKind: "contact",
        entityId: id,
        summary: `${user.name} removed a contact`,
      })
      .run();

    return c;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete contact." };
  }

  if (!c) return { ok: false, error: "Contact not found." };
  if (c.organizationId) revalidatePath(`/clients/${c.organizationId}`);
  revalidatePath("/clients/people");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Comments / notes                                                   */
/* ------------------------------------------------------------------ */

export async function addComment(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const organizationId = clean(form.get("organizationId"));
  const body = clean(form.get("body"));
  if (!organizationId) return { ok: false, error: "Missing organization id." };
  if (!body) return { ok: false, error: "Note cannot be empty." };

  // Resolve @mentions by display name (best-effort) against active users.
  const mentionTokens = Array.from(body.matchAll(/@([\w.\-]+)/g)).map((m) => m[1].toLowerCase());
  let mentionedIds: string[] = [];
  if (mentionTokens.length) {
    let all;
    try {
      all = await db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.active, true));
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to add note." };
    }
    mentionedIds = all
      .filter((u) => {
        const handle = u.name.replace(/\s+/g, "").toLowerCase();
        const first = u.name.split(/\s+/)[0]?.toLowerCase() ?? "";
        const emailLocal = u.email.split("@")[0].toLowerCase();
        return mentionTokens.some(
          (t) => handle.startsWith(t) || first === t || emailLocal === t,
        );
      })
      .map((u) => u.id);
  }

  // Insert comment + activity + mention notifications atomically.
  let commentId: string;
  let mentionNotifications: (typeof schema.notifications.$inferSelect)[];
  try {
    ({ commentId, mentionNotifications } = db.transaction((tx) => {
    const [row] = tx
      .insert(comments)
      .values({
        entityKind: "organization",
        entityId: organizationId,
        authorId: user.id,
        body,
        mentions: mentionedIds.length ? mentionedIds : undefined,
      })
      .returning({ id: comments.id })
      .all();
    if (!row) throw new Error("Note could not be created.");

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "commented",
        entityKind: "organization",
        entityId: organizationId,
        summary: `${user.name} added a note`,
        meta: { commentId: row.id },
      })
      .run();

    const mentionNotifications: (typeof schema.notifications.$inferSelect)[] = [];
    for (const uid of mentionedIds) {
      if (uid === user.id) continue;
      const [n] = tx
        .insert(notifications)
        .values({
          userId: uid,
          type: "mention",
          title: `${user.name} mentioned you`,
          body: body.slice(0, 140),
          entityKind: "organization",
          entityId: organizationId,
        })
        .returning()
        .all();
      if (n) mentionNotifications.push(n);
    }

    return { commentId: row.id, mentionNotifications };
    }));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add note." };
  }

  // Emit the FULL inserted notification row to each mentioned user.
  for (const n of mentionNotifications) {
    emitToUser(n.userId, "notification", n);
  }

  revalidatePath(`/clients/${organizationId}`);
  return { ok: true, data: { id: commentId } };
}

/* ------------------------------------------------------------------ */
/* Custom fields                                                      */
/* ------------------------------------------------------------------ */

export async function setCustomFieldValue(
  fieldId: string,
  entityId: string,
  value: string | null,
): Promise<ActionResult> {
  await requireWrite();
  if (!fieldId || !entityId) return { ok: false, error: "Missing field or entity." };

  try {
    const existing = await db
      .select({ id: customFieldValues.id })
      .from(customFieldValues)
      .where(and(eq(customFieldValues.fieldId, fieldId), eq(customFieldValues.entityId, entityId)))
      .limit(1);

    if (existing.length) {
      await db
        .update(customFieldValues)
        .set({ value })
        .where(eq(customFieldValues.id, existing[0].id));
    } else {
      await db.insert(customFieldValues).values({ fieldId, entityId, value });
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save custom field." };
  }

  revalidatePath(`/clients/${entityId}`);
  return { ok: true };
}
