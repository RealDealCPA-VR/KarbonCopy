import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { absoluteStoragePath } from "../_storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/documents/[id] — stream a stored document (auth required). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  let doc;
  try {
    [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id))
      .limit(1);
  } catch (err) {
    console.error("[download] document lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load document." }, { status: 500 });
  }

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Authorize: managers+ can download anything; otherwise the requester must own
  // the document (uploader) or own the client org it belongs to. This blocks the
  // IDOR where any authenticated user (incl. read-only / other-client staff)
  // could fetch ANY document by id.
  let authorized = hasRole(user, "manager") || doc.uploadedById === user.id;
  if (!authorized && doc.organizationId) {
    try {
      const [org] = await db
        .select({ ownerId: schema.organizations.ownerId })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, doc.organizationId))
        .limit(1);
      if (org?.ownerId && org.ownerId === user.id) authorized = true;
    } catch (err) {
      console.error("[download] org authz lookup failed:", (err as Error).message);
      return NextResponse.json({ error: "Failed to load document." }, { status: 500 });
    }
  }
  if (!authorized) {
    return NextResponse.json({ error: "You do not have access to this document." }, { status: 403 });
  }

  // Only serve files we actually stored locally (skip UNC/file-server pointers).
  if (doc.storagePath.includes(":") || doc.storagePath.startsWith("\\\\")) {
    return NextResponse.json({ error: "File not available for download." }, { status: 409 });
  }

  const abs = absoluteStoragePath(doc.storagePath);
  let size = doc.sizeBytes ?? undefined;
  try {
    const st = await stat(abs);
    size = st.size;
  } catch {
    return NextResponse.json({ error: "File missing on disk." }, { status: 410 });
  }

  const nodeStream = createReadStream(abs);
  // Handle mid-stream filesystem errors (file removed/permission lost) so they
  // log cleanly instead of surfacing as an unhandled 'error' event.
  nodeStream.on("error", (err) => console.error("[download] stream error on", abs, ":", err.message));
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  const headers = new Headers();
  headers.set("Content-Type", doc.mimeType || "application/octet-stream");
  if (size != null) headers.set("Content-Length", String(size));
  headers.set(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(doc.name)}"`,
  );
  headers.set("Cache-Control", "private, no-store");

  return new NextResponse(webStream, { headers });
}
