import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getPortalUser } from "@/lib/portal-auth";
import { absoluteStoragePath } from "@/app/api/documents/_storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portal/documents/[id] — stream a document to an authenticated CLIENT.
 *
 * PUBLIC SURFACE (kc_portal realm): NEVER call getCurrentUser() here. The
 * critical authz invariant is documents.organizationId === the portal user's
 * contact.organizationId — a client must never download another org's file.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const portal = await getPortalUser();
  if (!portal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = portal.organization?.id;
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  let doc;
  try {
    [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id))
      .limit(1);
  } catch (err) {
    console.error("[portal/download] document lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load document." }, { status: 500 });
  }

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Hard org scope: the document MUST belong to this client's organization.
  if (!doc.organizationId || doc.organizationId !== orgId) {
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
  nodeStream.on("error", (err) => console.error("[portal/download] stream error on", abs, ":", err.message));
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  const headers = new Headers();
  headers.set("Content-Type", doc.mimeType || "application/octet-stream");
  if (size != null) headers.set("Content-Length", String(size));
  headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.name)}"`);
  headers.set("Cache-Control", "private, no-store");

  return new NextResponse(webStream, { headers });
}
