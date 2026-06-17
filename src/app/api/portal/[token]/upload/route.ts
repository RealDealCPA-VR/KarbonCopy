import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { broadcast, emitToUser } from "@/server/realtime";
import { storeUpload, UploadError, MAX_UPLOAD_BYTES, removeStoredFile, absoluteStoragePath } from "@/app/api/documents/_storage";
import { checkRateLimit, clientIp } from "@/app/api/documents/_ratelimit";
import type { RequestStatus } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public endpoint: throttle per token+IP. 30 uploads / 10 min.
const RL_LIMIT = 30;
const RL_WINDOW_MS = 10 * 60_000;

/**
 * POST /api/portal/[token]/upload — PUBLIC upload, guarded by magicToken only.
 * Fields: file (required), itemIndex (which requested item this fulfills).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: "Invalid request link." }, { status: 404 });

  // Throttle per token + IP before doing any work.
  const rl = checkRateLimit(`portal-upload:${token}:${clientIp(req)}`, RL_LIMIT, RL_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let request;
  try {
    [request] = await db
      .select()
      .from(schema.documentRequests)
      .where(eq(schema.documentRequests.magicToken, token))
      .limit(1);
  } catch (err) {
    console.error("[portal/upload] request lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load upload request." }, { status: 500 });
  }

  if (!request) {
    return NextResponse.json({ error: "This upload link is invalid." }, { status: 404 });
  }
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This upload link has expired." }, { status: 410 });
  }

  // Reject oversize bodies up front, before buffering the request.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const items = Array.isArray(request.items) ? [...request.items] : [];
  const rawIndex = Number(form.get("itemIndex"));
  const itemIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < items.length ? rawIndex : -1;

  // Persist the file to disk (async) before the synchronous DB transaction.
  let stored;
  try {
    stored = await storeUpload(file);
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[portal/upload] file storage failed:", (err as Error).message);
    return NextResponse.json({ error: "File storage failed." }, { status: 500 });
  }

  // Atomically: insert the document + activity, and re-read/modify/write the
  // request items so a concurrent upload can't clobber another item's fulfilled
  // flag (lost-update race). better-sqlite3's transaction callback is SYNCHRONOUS,
  // so all queries inside use the sync drizzle API (.get/.run/.returning().all()).
  let doc: typeof schema.documents.$inferSelect;
  let label = stored.name;
  let nextStatus: RequestStatus;
  try {
    ({ doc, label, nextStatus } = db.transaction((tx) => {
      // Re-read the request fresh inside the tx to base the merge on current state.
      const fresh = tx
        .select()
        .from(schema.documentRequests)
        .where(eq(schema.documentRequests.id, request.id))
        .limit(1)
        .all()[0];
      if (!fresh) throw new Error("REQUEST_GONE");

      const txItems = Array.isArray(fresh.items) ? [...fresh.items] : [];

      const [inserted] = tx
        .insert(schema.documents)
        .values({
          id: stored.id,
          name: stored.name,
          storagePath: stored.storagePath,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          organizationId: fresh.organizationId,
          workItemId: fresh.workItemId,
          uploadedById: null,
          source: "portal",
        })
        .returning()
        .all();
      if (!inserted) throw new Error("DOCUMENT_INSERT_FAILED");

      let txLabel = stored.name;
      if (itemIndex >= 0 && itemIndex < txItems.length) {
        txItems[itemIndex] = { ...txItems[itemIndex], fulfilled: true, documentId: inserted.id };
        txLabel = txItems[itemIndex].label;
      }

      const allFulfilled = txItems.length > 0 && txItems.every((i) => i.fulfilled);
      const anyFulfilled = txItems.some((i) => i.fulfilled);
      const status: RequestStatus = allFulfilled ? "fulfilled" : anyFulfilled ? "partial" : fresh.status;

      tx
        .update(schema.documentRequests)
        .set({ items: txItems, status })
        .where(eq(schema.documentRequests.id, fresh.id))
        .run();

      tx
        .insert(schema.activities)
        .values({
          actorId: null,
          verb: "uploaded",
          entityKind: "document",
          entityId: inserted.id,
          summary: `Client uploaded ${txLabel} for "${fresh.title}"`,
          meta: { source: "portal", requestId: fresh.id },
        })
        .run();

      return { doc: inserted, label: txLabel, nextStatus: status };
    }));
  } catch (err) {
    // Roll back the on-disk file so we don't orphan it when the tx aborts.
    await removeStoredFile(stored.storagePath);
    if (err instanceof Error && err.message === "REQUEST_GONE") {
      return NextResponse.json({ error: "This upload link is invalid." }, { status: 404 });
    }
    console.error("[portal/upload] commit failed:", (err as Error).message);
    return NextResponse.json({ error: "We couldn't save the upload." }, { status: 500 });
  }

  // Run the on-prem OCR → classify → extract → auto-match pipeline on the
  // client-uploaded file (fire-and-forget), same as watcher/manual uploads.
  try {
    const { processDocument } = await import("@/server/ocr");
    void processDocument({
      sourcePath: absoluteStoragePath(doc.storagePath),
      documentId: doc.id,
      organizationId: doc.organizationId ?? null,
    }).catch((e) => console.error("[portal/upload] OCR pipeline error:", (e as Error).message));
  } catch (e) {
    console.error("[portal/upload] failed to start OCR pipeline:", (e as Error).message);
  }

  // Notify the staff member who created the request + live broadcast (outside the tx).
  // Best-effort: the document is already persisted, so a notification failure must
  // not turn a successful upload into a 500 for the client.
  if (request.createdById) {
    try {
      const [notif] = await db
        .insert(schema.notifications)
        .values({
          userId: request.createdById,
          type: "file_alert",
          title: "Client uploaded a document",
          body: `${label} was uploaded for "${request.title}".`,
          entityKind: "document",
          entityId: doc.id,
        })
        .returning();
      // Emit the full row so the client toast has title/body, matching every
      // other notification emit in the app.
      if (notif) emitToUser(request.createdById, "notification", notif);
    } catch (err) {
      console.error("[portal/upload] notification failed:", (err as Error).message);
    }
  }
  broadcast("file_event", {
    type: "portal_upload",
    requestId: request.id,
    organizationId: request.organizationId,
    documentId: doc.id,
    label,
    status: nextStatus,
  });

  return NextResponse.json({
    ok: true,
    document: { id: doc.id, name: doc.name },
    itemIndex,
    status: nextStatus,
  });
}
