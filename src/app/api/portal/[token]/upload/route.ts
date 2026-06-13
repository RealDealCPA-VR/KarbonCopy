import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { broadcast, emitToUser } from "@/server/realtime";
import { storeUpload } from "@/app/api/documents/_storage";
import type { RequestStatus } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/portal/[token]/upload — PUBLIC upload, guarded by magicToken only.
 * Fields: file (required), itemIndex (which requested item this fulfills).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: "Invalid request link." }, { status: 404 });

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

  const stored = await storeUpload(file);

  const [doc] = await db
    .insert(schema.documents)
    .values({
      id: stored.id,
      name: stored.name,
      storagePath: stored.storagePath,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      organizationId: request.organizationId,
      workItemId: request.workItemId,
      uploadedById: null,
      source: "portal",
    })
    .returning();

  // Mark the matching requested item fulfilled.
  let label = stored.name;
  if (itemIndex >= 0) {
    items[itemIndex] = { ...items[itemIndex], fulfilled: true, documentId: doc.id };
    label = items[itemIndex].label;
  }

  const allFulfilled = items.length > 0 && items.every((i) => i.fulfilled);
  const anyFulfilled = items.some((i) => i.fulfilled);
  const nextStatus: RequestStatus = allFulfilled ? "fulfilled" : anyFulfilled ? "partial" : request.status;

  await db
    .update(schema.documentRequests)
    .set({ items, status: nextStatus })
    .where(eq(schema.documentRequests.id, request.id));

  await db.insert(schema.activities).values({
    actorId: null,
    verb: "uploaded",
    entityKind: "document",
    entityId: doc.id,
    summary: `Client uploaded ${label} for "${request.title}"`,
    meta: { source: "portal", requestId: request.id },
  });

  // Notify the staff member who created the request + live broadcast.
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
