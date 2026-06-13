import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { storeUpload } from "../_storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/documents/upload — internal multipart upload.
 * Fields: file (required), folderId?, organizationId?, workItemId?
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const folderId = str(form.get("folderId"));
  const organizationId = str(form.get("organizationId"));
  const workItemId = str(form.get("workItemId"));

  const stored = await storeUpload(file);

  const [row] = await db
    .insert(schema.documents)
    .values({
      id: stored.id,
      name: stored.name,
      storagePath: stored.storagePath,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      folderId,
      organizationId,
      workItemId,
      uploadedById: user.id,
      source: "upload",
    })
    .returning();

  await db.insert(schema.activities).values({
    actorId: user.id,
    verb: "uploaded",
    entityKind: "document",
    entityId: row.id,
    summary: `${user.name} uploaded ${stored.name}`,
    meta: { sizeBytes: stored.sizeBytes, organizationId },
  });

  return NextResponse.json({ ok: true, document: row });
}

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
