import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { broadcast, emitToUser } from "@/server/realtime";
import { absoluteStoragePath, UPLOADS_DIR } from "@/app/api/documents/_storage";
import { checkRateLimit, clientIp } from "@/app/api/documents/_ratelimit";
import { chainHash, stampSignature, decodePngDataUrl } from "@/lib/esign";
import { createId } from "@/db/schema";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public endpoint: throttle per token + IP. Signing is a one-shot, so keep it tight.
const RL_LIMIT = 10;
const RL_WINDOW_MS = 10 * 60_000;

type Body = {
  signerName?: unknown;
  drawnSignature?: unknown;
  consent?: unknown;
};

/**
 * POST /api/portal/sign/[token] — PUBLIC signing endpoint, guarded by magicToken.
 *
 * Stamps the typed/drawn signature onto the source PDF, writes the signed PDF to
 * the uploads dir, and atomically: updates the request (signed/signedAt/signerName/
 * signedDocumentPath) + appends a hash-chained "signed" audit event. Then notifies
 * the request creator and logs an activity.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: "Invalid signing link." }, { status: 404 });

  const ip = clientIp(req);
  const rl = checkRateLimit(`sign:${token}:${ip}`, RL_LIMIT, RL_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const signerName = typeof body.signerName === "string" ? body.signerName.trim() : "";
  if (signerName.length < 2 || signerName.length > 120) {
    return NextResponse.json({ error: "Please enter your full legal name." }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json({ error: "You must consent to sign electronically." }, { status: 400 });
  }
  const drawnSignature =
    typeof body.drawnSignature === "string" && body.drawnSignature ? body.drawnSignature : null;
  // Validate the drawn signature is a real PNG data-url before doing any work.
  if (drawnSignature && !decodePngDataUrl(drawnSignature)) {
    return NextResponse.json({ error: "The drawn signature was invalid." }, { status: 400 });
  }

  // Load the request + its source document.
  let request;
  try {
    [request] = await db
      .select()
      .from(schema.signatureRequests)
      .where(eq(schema.signatureRequests.magicToken, token))
      .limit(1);
  } catch (err) {
    console.error("[portal/sign] request lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load signing request." }, { status: 500 });
  }

  if (!request) return NextResponse.json({ error: "This signing link is invalid." }, { status: 404 });
  if (request.status === "signed") {
    return NextResponse.json({ error: "This document has already been signed." }, { status: 409 });
  }
  if (request.status === "declined") {
    return NextResponse.json({ error: "This request is no longer active." }, { status: 409 });
  }
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This signing link has expired." }, { status: 410 });
  }
  if (!request.documentId) {
    return NextResponse.json({ error: "No document is attached to this request." }, { status: 409 });
  }

  let doc;
  try {
    [doc] = await db
      .select({ storagePath: schema.documents.storagePath, name: schema.documents.name })
      .from(schema.documents)
      .where(eq(schema.documents.id, request.documentId))
      .limit(1);
  } catch (err) {
    console.error("[portal/sign] document lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load the document." }, { status: 500 });
  }
  if (!doc) return NextResponse.json({ error: "The document could not be found." }, { status: 404 });

  // Read the source PDF bytes (local uploads only; never a UNC/file-server path).
  if (doc.storagePath.includes(":") || doc.storagePath.startsWith("\\\\") || doc.storagePath.startsWith("/")) {
    return NextResponse.json({ error: "This document cannot be signed online." }, { status: 409 });
  }
  let sourceBytes: Buffer;
  try {
    sourceBytes = await readFile(absoluteStoragePath(doc.storagePath));
  } catch {
    return NextResponse.json({ error: "The document file is missing." }, { status: 410 });
  }

  // Stamp the signature + certificate page.
  const now = new Date();
  let signedBytes: Uint8Array;
  try {
    signedBytes = await stampSignature(sourceBytes, {
      signerName,
      signedAtText: now.toLocaleString("en-US", { timeZoneName: "short" }),
      drawnSignaturePng: drawnSignature,
      verificationId: request.id,
    });
  } catch {
    return NextResponse.json(
      { error: "We couldn't process this PDF for signing." },
      { status: 422 },
    );
  }

  // Persist the signed PDF to the uploads dir (relative path stored on the request).
  const signedStorageName = `${createId()}-signed.pdf`;
  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(join(UPLOADS_DIR, signedStorageName), Buffer.from(signedBytes));
  } catch {
    return NextResponse.json({ error: "We couldn't save the signed document." }, { status: 500 });
  }

  const ua = req.headers.get("user-agent") || null;

  // Atomically update the request + append the hash-chained "signed" event.
  try {
    db.transaction((tx) => {
      // Re-read inside the tx and re-check status to avoid a double-sign race.
      const fresh = tx
        .select()
        .from(schema.signatureRequests)
        .where(eq(schema.signatureRequests.id, request.id))
        .limit(1)
        .all()[0];
      if (!fresh) throw new Error("REQUEST_GONE");
      if (fresh.status === "signed") throw new Error("ALREADY_SIGNED");

      // Compute the next chain hash from the latest stored event.
      const events = tx
        .select({ hash: schema.signatureEvents.hash })
        .from(schema.signatureEvents)
        .where(eq(schema.signatureEvents.requestId, request.id))
        .orderBy(schema.signatureEvents.createdAt)
        .all();
      const prevHash = events.length ? events[events.length - 1].hash : null;

      const payload = {
        type: "signed" as const,
        requestId: request.id,
        actorName: signerName,
        ip,
        userAgent: ua,
        at: now.getTime(),
        meta: { method: drawnSignature ? "typed+drawn" : "typed", consent: true },
      };
      const hash = chainHash(prevHash, payload);

      tx.update(schema.signatureRequests)
        .set({
          status: "signed",
          signerName,
          signedDocumentPath: signedStorageName,
          signedAt: now,
        })
        .where(eq(schema.signatureRequests.id, request.id))
        .run();

      tx.insert(schema.signatureEvents)
        .values({
          requestId: request.id,
          type: "signed",
          actorName: signerName,
          ip,
          userAgent: ua,
          hash,
          meta: payload.meta,
          createdAt: now,
        })
        .run();

      tx.insert(schema.activities)
        .values({
          actorId: null,
          verb: "signed",
          entityKind: "signature_request",
          entityId: request.id,
          summary: `${signerName} signed "${request.title}"`,
          meta: { source: "portal", method: drawnSignature ? "typed+drawn" : "typed" },
        })
        .run();
    });
  } catch (err) {
    // Best-effort: the signed file is now orphaned but harmless; we don't delete
    // it on ALREADY_SIGNED because the prior signed file is the canonical one.
    if (err instanceof Error && err.message === "ALREADY_SIGNED") {
      return NextResponse.json({ error: "This document has already been signed." }, { status: 409 });
    }
    if (err instanceof Error && err.message === "REQUEST_GONE") {
      return NextResponse.json({ error: "This signing link is invalid." }, { status: 404 });
    }
    console.error("[portal/sign] commit failed:", (err as Error).message);
    return NextResponse.json({ error: "We couldn't record the signature." }, { status: 500 });
  }

  // Notify the request creator + live broadcast (outside the tx). Best-effort:
  // the signature is already committed, so a notification failure must not turn a
  // successful signing into a 500 for the client.
  if (request.createdById) {
    try {
      const [notif] = await db
        .insert(schema.notifications)
        .values({
          userId: request.createdById,
          type: "signature",
          title: "A document was signed",
          body: `${signerName} signed "${request.title}".`,
          entityKind: "signature_request",
          entityId: request.id,
        })
        .returning();
      if (notif) emitToUser(request.createdById, "notification", notif);
    } catch (err) {
      console.error("[portal/sign] notification failed:", (err as Error).message);
    }
  }
  broadcast("signature_event", {
    type: "signed",
    requestId: request.id,
    organizationId: request.organizationId,
    signerName,
  });

  return NextResponse.json({ ok: true, status: "signed" });
}
