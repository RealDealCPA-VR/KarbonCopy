import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { broadcast, emitToUser } from "@/server/realtime";
import { storeUpload, UploadError, MAX_UPLOAD_BYTES, removeStoredFile } from "@/app/api/documents/_storage";
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

  const [request] = await db
    .select()
    .from(schema.documentRequests)
    .where(eq(schema.documentRequests.magicToken, token))
    .limit(1);

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
    throw err;
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
    throw err;
  }

  // Notify the staff member who created the request + live broadcast (outside the tx).
  if (request.createdById) {
    await db.insert(schema.notifications).values({
      userId: request.createdById,
      type: "file_alert",
      title: "Client uploaded a document",
      body: `${label} was uploaded for "${request.title}".`,
      entityKind: "document",
      entityId: doc.id,
    });
    emitToUser(request.createdById, "notification", {
      type: "file_alert",
      entityKind: "document",
      entityId: doc.id,
    });
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
