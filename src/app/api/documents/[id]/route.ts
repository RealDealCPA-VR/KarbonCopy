import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { absoluteStoragePath } from "../_storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/documents/[id] — stream a stored document (auth required). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const [doc] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
