import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { absoluteStoragePath } from "@/app/api/documents/_storage";
import { checkRateLimit, clientIp } from "@/app/api/documents/_ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_LIMIT = 60;
const RL_WINDOW_MS = 10 * 60_000;

/**
 * GET /api/portal/sign/[token]/document — PUBLIC: stream the SOURCE PDF for the
 * signer to review. Guarded by the magicToken (the access credential), and only
 * for requests that aren't expired/declined. Served inline so it previews.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: "Invalid link." }, { status: 404 });

  const rl = checkRateLimit(`sign-doc:${token}:${clientIp(req)}`, RL_LIMIT, RL_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let request;
  try {
    [request] = await db
      .select({
        status: schema.signatureRequests.status,
        expiresAt: schema.signatureRequests.expiresAt,
        docName: schema.documents.name,
        storagePath: schema.documents.storagePath,
        mimeType: schema.documents.mimeType,
      })
      .from(schema.signatureRequests)
      .leftJoin(schema.documents, eq(schema.signatureRequests.documentId, schema.documents.id))
      .where(eq(schema.signatureRequests.magicToken, token))
      .limit(1);
  } catch (err) {
    console.error("[portal/sign/document] lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load document." }, { status: 500 });
  }

  if (!request || !request.storagePath) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (request.status === "declined") {
    return NextResponse.json({ error: "This request is no longer active." }, { status: 410 });
  }
  if (request.expiresAt && request.expiresAt.getTime() < Date.now() && request.status !== "signed") {
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }
  if (
    request.storagePath.includes(":") ||
    request.storagePath.startsWith("\\\\") ||
    request.storagePath.startsWith("/")
  ) {
    return NextResponse.json({ error: "Document not available." }, { status: 409 });
  }

  const abs = absoluteStoragePath(request.storagePath);
  let size: number | undefined;
  try {
    size = (await stat(abs)).size;
  } catch {
    return NextResponse.json({ error: "Document file missing." }, { status: 410 });
  }

  const webStream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
  const headers = new Headers();
  headers.set("Content-Type", request.mimeType || "application/pdf");
  if (size != null) headers.set("Content-Length", String(size));
  headers.set(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(request.docName || "document.pdf")}"`,
  );
  headers.set("Cache-Control", "private, no-store");
  return new NextResponse(webStream, { headers });
}
