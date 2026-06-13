import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { storeUpload, UploadError, MAX_UPLOAD_BYTES } from "../_storage";
import { checkRateLimit, clientIp } from "../_ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-IP fixed window: 30 uploads / 10 min.
const RL_LIMIT = 30;
const RL_WINDOW_MS = 10 * 60_000;

/**
 * POST /api/documents/upload — internal multipart upload.
 * Fields: file (required), folderId?, organizationId?, workItemId?
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read-only users cannot upload.
  if (!hasRole(user, "staff")) {
    return NextResponse.json({ error: "You do not have permission to upload." }, { status: 403 });
  }

  const rl = checkRateLimit(`doc-upload:${clientIp(req)}`, RL_LIMIT, RL_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
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

  const folderId = str(form.get("folderId"));
  const organizationId = str(form.get("organizationId"));
  const workItemId = str(form.get("workItemId"));

  let stored;
  try {
    stored = await storeUpload(file);
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

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
