"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { requireWrite, requireManager } from "@/lib/auth";
import { chainHash } from "@/lib/esign";

const { signatureRequests, signatureEvents, documents, activities } = schema;

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function clean(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function nullableId(v: string | null): string | null {
  if (!v) return null;
  return v === "none" ? null : v;
}

/* ------------------------------------------------------------------ */
/* Create a signature request (draft)                                 */
/* ------------------------------------------------------------------ */

/**
 * Create a signature request. The source PDF must already exist as a `documents`
 * row (uploaded via /api/documents/upload, or picked from the library). We store
 * its id; the actual signing reads its bytes at stamp time.
 *
 * The request is created in "draft", with a "created" audit event (genesis of
 * the hash chain). Call `sendSignatureRequest` to move it to "sent".
 */
export async function createSignatureRequest(
  form: FormData,
): Promise<ActionResult<{ id: string; token: string }>> {
  const user = await requireWrite();

  const title = clean(form.get("title"));
  if (!title) return { ok: false, error: "A title is required." };

  const documentId = clean(form.get("documentId"));
  if (!documentId) return { ok: false, error: "Pick or upload a PDF to be signed." };

  // Validate the document exists and is a PDF we can stamp.
  let doc;
  try {
    [doc] = await db
      .select({ id: documents.id, mime: documents.mimeType, name: documents.name, storagePath: documents.storagePath })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load the document." };
  }
  if (!doc) return { ok: false, error: "That document could not be found." };
  const looksPdf =
    (doc.mime && doc.mime.includes("pdf")) || doc.storagePath.toLowerCase().endsWith(".pdf") ||
    doc.name.toLowerCase().endsWith(".pdf");
  if (!looksPdf) return { ok: false, error: "Only PDF documents can be signed." };

  const organizationId = nullableId(clean(form.get("organizationId")));
  const contactId = nullableId(clean(form.get("contactId")));
  const workItemId = nullableId(clean(form.get("workItemId")));
  const message = clean(form.get("message"));

  let expiresAt: Date | null = null;
  const expDays = clean(form.get("expiresInDays"));
  if (expDays) {
    const n = Number(expDays);
    if (Number.isFinite(n) && n > 0) expiresAt = new Date(Date.now() + n * 86400_000);
  }

  const magicToken = nanoid(32);
  const now = new Date();

  // Insert the request + genesis audit event atomically (sync better-sqlite3 tx).
  let created: { id: string };
  try {
    created = db.transaction((tx) => {
    const [req] = tx
      .insert(signatureRequests)
      .values({
        title,
        organizationId,
        contactId,
        documentId,
        workItemId,
        status: "draft",
        magicToken,
        message,
        expiresAt,
        createdById: user.id,
      })
      .returning({ id: signatureRequests.id })
      .all();
    if (!req) throw new Error("Signature request could not be created.");

    const payload = {
      type: "created" as const,
      requestId: req.id,
      actorName: user.name,
      ip: null,
      userAgent: null,
      at: now.getTime(),
      meta: { documentId, title },
    };
    const hash = chainHash(null, payload);

    tx.insert(signatureEvents)
      .values({
        requestId: req.id,
        type: "created",
        actorName: user.name,
        ip: null,
        userAgent: null,
        hash,
        meta: payload.meta,
        createdAt: now,
      })
      .run();

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "created",
        entityKind: "signature_request",
        entityId: req.id,
        summary: `${user.name} created signature request "${title}"`,
        meta: { documentId },
      })
      .run();

    return req;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create signature request." };
  }

  revalidatePath("/signatures");
  return { ok: true, data: { id: created.id, token: magicToken } };
}

/* ------------------------------------------------------------------ */
/* Send (draft -> sent)                                               */
/* ------------------------------------------------------------------ */

/** Mark a draft request as sent and append a "sent" audit event. */
export async function sendSignatureRequest(form: FormData): Promise<ActionResult> {
  const user = await requireWrite();
  const id = clean(form.get("id"));
  if (!id) return { ok: false, error: "Missing request id." };

  let reqRow: typeof signatureRequests.$inferSelect | undefined;
  let events: { hash: string | null }[];
  try {
    [reqRow] = await db
      .select()
      .from(signatureRequests)
      .where(eq(signatureRequests.id, id))
      .limit(1);

    // Compute the next chain hash from the latest stored event.
    events = await db
      .select({ hash: signatureEvents.hash })
      .from(signatureEvents)
      .where(eq(signatureEvents.requestId, id))
      .orderBy(signatureEvents.createdAt);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load signature request." };
  }
  if (!reqRow) return { ok: false, error: "Request not found." };
  if (reqRow.status === "signed") return { ok: false, error: "This request is already signed." };
  const req = reqRow;
  const last = events.length ? events[events.length - 1] : undefined;

  const now = new Date();
  const payload = {
    type: "sent" as const,
    requestId: id,
    actorName: user.name,
    ip: null,
    userAgent: null,
    at: now.getTime(),
    meta: null,
  };
  const hash = chainHash(last?.hash ?? null, payload);

  try {
    db.transaction((tx) => {
    tx.update(signatureRequests)
      .set({ status: "sent" })
      .where(eq(signatureRequests.id, id))
      .run();
    tx.insert(signatureEvents)
      .values({
        requestId: id,
        type: "sent",
        actorName: user.name,
        hash,
        createdAt: now,
      })
      .run();
    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "sent",
        entityKind: "signature_request",
        entityId: id,
        summary: `${user.name} sent signature request "${req.title}"`,
      })
      .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send signature request." };
  }

  revalidatePath("/signatures");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Delete                                                             */
/* ------------------------------------------------------------------ */

export async function deleteSignatureRequest(form: FormData): Promise<ActionResult> {
  const user = await requireManager();
  const id = clean(form.get("id"));
  if (!id) return { ok: false, error: "Missing request id." };

  try {
    const [req] = await db
      .select({ title: signatureRequests.title })
      .from(signatureRequests)
      .where(eq(signatureRequests.id, id))
      .limit(1);
    if (!req) return { ok: false, error: "Request not found." };

    // signatureEvents cascade-delete via the FK.
    await db.delete(signatureRequests).where(eq(signatureRequests.id, id));
    await db.insert(activities).values({
      actorId: user.id,
      verb: "deleted",
      entityKind: "signature_request",
      entityId: id,
      summary: `${user.name} deleted signature request "${req.title}"`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete signature request." };
  }

  revalidatePath("/signatures");
  return { ok: true };
}
