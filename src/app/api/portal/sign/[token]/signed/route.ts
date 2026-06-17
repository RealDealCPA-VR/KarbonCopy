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
 * GET /api/portal/sign/[token]/signed — stream the SIGNED PDF.
 *
 * Guarded by the magicToken: usable by the signer (download their copy) and by
 * staff (the /signatures card links here). The signed file is the stamped output
 * stored on the request. Only available once the request is signed.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: "Invalid link." }, { status: 404 });

  const rl = checkRateLimit(`sign-out:${token}:${clientIp(req)}`, RL_LIMIT, RL_WINDOW_MS);
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
        title: schema.signatureRequests.title,
        signedDocumentPath: schema.signatureRequests.signedDocumentPath,
      })
      .from(schema.signatureRequests)
      .where(eq(schema.signatureRequests.magicToken, token))
      .limit(1);
  } catch (err) {
    console.error("[portal/signed] request lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load document." }, { status: 500 });
  }

  if (!request) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (request.status !== "signed" || !request.signedDocumentPath) {
    return NextResponse.json({ error: "This document hasn't been signed yet." }, { status: 409 });
  }

  const abs = absoluteStoragePath(request.signedDocumentPath);
  let size: number | undefined;
  try {
    size = (await stat(abs)).size;
  } catch {
    return NextResponse.json({ error: "Signed file missing." }, { status: 410 });
  }

  const safeTitle = (request.title || "document").replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const nodeStream = createReadStream(abs);
  nodeStream.on("error", (err) => console.error("[portal/signed] stream error on", abs, ":", err.message));
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  const headers = new Headers();
  headers.set("Content-Type", "application/pdf");
  if (size != null) headers.set("Content-Length", String(size));
  headers.set("Content-Disposition", `attachment; filename="${safeTitle}-signed.pdf"`);
  headers.set("Cache-Control", "private, no-store");
  return new NextResponse(webStream, { headers });
}
