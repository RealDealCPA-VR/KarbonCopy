"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { requireWrite, requireManager } from "@/lib/auth";
import { removeStoredFile } from "@/app/api/documents/_storage";

const { folders, documents, documentRequests, activities } = schema;

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function clean(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/* ------------------------------------------------------------------ */
/* Folders                                                            */
/* ------------------------------------------------------------------ */

export async function createFolder(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const name = clean(form.get("name"));
  if (!name) return { ok: false, error: "Folder name is required." };
  const organizationId = clean(form.get("organizationId"));
  if (!organizationId) return { ok: false, error: "A client is required for the folder." };
  const parentId = clean(form.get("parentId"));

  let row;
  try {
    [row] = await db
      .insert(folders)
      .values({ name, organizationId, parentId })
      .returning({ id: folders.id });
    if (!row) return { ok: false, error: "Folder could not be created." };

    await db.insert(activities).values({
      actorId: user.id,
      verb: "created",
      entityKind: "folder",
      entityId: row.id,
      summary: `${user.name} created folder "${name}"`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Folder could not be created." };
  }

  revalidatePath("/documents");
  return { ok: true, data: { id: row.id } };
}

export async function renameFolder(form: FormData): Promise<ActionResult> {
  const user = await requireWrite();
  const id = clean(form.get("id"));
  const name = clean(form.get("name"));
  if (!id || !name) return { ok: false, error: "Missing folder id or name." };
  try {
    const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
    if (!folder) return { ok: false, error: "Folder not found." };
    await db.update(folders).set({ name }).where(eq(folders.id, id));
    await db.insert(activities).values({
      actorId: user.id,
      verb: "updated",
      entityKind: "folder",
      entityId: id,
      summary: `${user.name} renamed a folder to "${name}"`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename folder." };
  }
  revalidatePath("/documents");
  return { ok: true };
}

export async function deleteFolder(form: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const id = clean(form.get("id"));
  if (!id) return { ok: false, error: "Missing folder id." };
  try {
    const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
    if (!folder) return { ok: false, error: "Folder not found." };
    // child folders/documents are detached via ON DELETE rules in the schema.
    await db.delete(folders).where(eq(folders.id, id));
    await db.insert(activities).values({
      actorId: user.id,
      verb: "deleted",
      entityKind: "folder",
      entityId: id,
      summary: `${user.name} deleted folder "${folder.name}"`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete folder." };
  }
  revalidatePath("/documents");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

export async function deleteDocument(form: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const id = clean(form.get("id"));
  if (!id) return { ok: false, error: "Missing document id." };

  try {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) return { ok: false, error: "Document not found." };

    await db.delete(documents).where(eq(documents.id, id));
    await removeStoredFile(doc.storagePath);

    await db.insert(activities).values({
      actorId: user.id,
      verb: "deleted",
      entityKind: "document",
      entityId: id,
      summary: `${user.name} deleted ${doc.name}`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete document." };
  }

  revalidatePath("/documents");
  return { ok: true };
}

export async function moveDocument(form: FormData): Promise<ActionResult> {
  const user = await requireWrite();
  const id = clean(form.get("id"));
  if (!id) return { ok: false, error: "Missing document id." };
  const folderId = clean(form.get("folderId"));
  try {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) return { ok: false, error: "Document not found." };
    await db.update(documents).set({ folderId }).where(eq(documents.id, id));
    await db.insert(activities).values({
      actorId: user.id,
      verb: "updated",
      entityKind: "document",
      entityId: id,
      summary: `${user.name} moved ${doc.name}`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to move document." };
  }
  revalidatePath("/documents");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Document requests                                                  */
/* ------------------------------------------------------------------ */

export async function createDocumentRequest(
  form: FormData,
): Promise<ActionResult<{ id: string; token: string }>> {
  const user = await requireWrite();
  const title = clean(form.get("title"));
  if (!title) return { ok: false, error: "A title is required." };
  const organizationId = clean(form.get("organizationId"));
  if (!organizationId) return { ok: false, error: "Please pick a client." };

  // items come as a JSON-encoded array of labels
  let labels: string[] = [];
  const rawItems = clean(form.get("items"));
  if (rawItems) {
    try {
      const parsed = JSON.parse(rawItems);
      if (Array.isArray(parsed)) labels = parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  if (labels.length === 0) {
    return { ok: false, error: "Add at least one requested item." };
  }

  const contactId = clean(form.get("contactId"));
  const workItemId = clean(form.get("workItemId"));
  const message = clean(form.get("message"));

  // expiry: number of days from now (optional)
  let expiresAt: Date | null = null;
  const expDays = clean(form.get("expiresInDays"));
  if (expDays) {
    const n = Number(expDays);
    if (Number.isFinite(n) && n > 0) expiresAt = new Date(Date.now() + n * 86400_000);
  }

  const magicToken = nanoid(32);

  let row;
  try {
    [row] = await db
      .insert(documentRequests)
      .values({
        title,
        message,
        organizationId,
        contactId,
        workItemId,
        items: labels.map((label) => ({ label, fulfilled: false })),
        status: "open",
        magicToken,
        expiresAt,
        createdById: user.id,
      })
      .returning({ id: documentRequests.id });
    if (!row) return { ok: false, error: "Document request could not be created." };

    await db.insert(activities).values({
      actorId: user.id,
      verb: "created",
      entityKind: "document",
      entityId: row.id,
      summary: `${user.name} created document request "${title}"`,
      meta: { items: labels.length },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Document request could not be created." };
  }

  revalidatePath("/documents/requests");
  return { ok: true, data: { id: row.id, token: magicToken } };
}

export async function deleteDocumentRequest(form: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const id = clean(form.get("id"));
  if (!id) return { ok: false, error: "Missing request id." };
  try {
    const [req] = await db.select().from(documentRequests).where(eq(documentRequests.id, id)).limit(1);
    if (!req) return { ok: false, error: "Request not found." };
    await db.delete(documentRequests).where(eq(documentRequests.id, id));
    await db.insert(activities).values({
      actorId: user.id,
      verb: "deleted",
      entityKind: "document_request",
      entityId: id,
      summary: `${user.name} deleted document request "${req.title}"`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete document request." };
  }
  revalidatePath("/documents/requests");
  return { ok: true };
}
