import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { chainHash } from "@/lib/esign";
import { SignInvalid } from "@/components/signatures/sign-invalid";
import { SignFlow } from "@/components/signatures/sign-flow";

export const dynamic = "force-dynamic";

// PUBLIC page — guarded by magicToken only. NEVER call getCurrentUser() here.
export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [request] = await db
    .select({
      id: schema.signatureRequests.id,
      title: schema.signatureRequests.title,
      message: schema.signatureRequests.message,
      status: schema.signatureRequests.status,
      signerName: schema.signatureRequests.signerName,
      signedAt: schema.signatureRequests.signedAt,
      expiresAt: schema.signatureRequests.expiresAt,
      contactId: schema.signatureRequests.contactId,
      orgName: schema.organizations.name,
      docName: schema.documents.name,
    })
    .from(schema.signatureRequests)
    .leftJoin(
      schema.organizations,
      eq(schema.signatureRequests.organizationId, schema.organizations.id),
    )
    .leftJoin(schema.documents, eq(schema.signatureRequests.documentId, schema.documents.id))
    .where(eq(schema.signatureRequests.magicToken, token))
    .limit(1);

  if (!request) return <SignInvalid reason="not-found" />;
  if (request.status === "declined") return <SignInvalid reason="declined" firmName={request.orgName} />;
  if (
    request.expiresAt &&
    request.expiresAt.getTime() < Date.now() &&
    request.status !== "signed"
  ) {
    return <SignInvalid reason="expired" firmName={request.orgName} />;
  }

  // Already signed — show a confirmation + download link.
  if (request.status === "signed") {
    return (
      <SignFlow
        token={token}
        title={request.title}
        message={request.message}
        firmName={request.orgName}
        docName={request.docName}
        suggestedName={null}
        alreadySigned
        signedName={request.signerName}
        signedAt={request.signedAt ? request.signedAt.toISOString() : null}
      />
    );
  }

  // Record a "viewed" audit event the first time the page is opened (status sent
  // -> viewed). Best-effort: a failure here must not block the signer.
  if (request.status === "sent") {
    try {
      const h = await headers();
      const ip =
        h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
      const ua = h.get("user-agent") || null;
      const now = new Date();

      const events = await db
        .select({ hash: schema.signatureEvents.hash })
        .from(schema.signatureEvents)
        .where(eq(schema.signatureEvents.requestId, request.id))
        .orderBy(schema.signatureEvents.createdAt);
      const prevHash = events.length ? events[events.length - 1].hash : null;

      const payload = {
        type: "viewed" as const,
        requestId: request.id,
        actorName: null,
        ip,
        userAgent: ua,
        at: now.getTime(),
        meta: null,
      };
      const hash = chainHash(prevHash, payload);

      db.transaction((tx) => {
        tx.update(schema.signatureRequests)
          .set({ status: "viewed" })
          .where(eq(schema.signatureRequests.id, request.id))
          .run();
        tx.insert(schema.signatureEvents)
          .values({
            requestId: request.id,
            type: "viewed",
            ip,
            userAgent: ua,
            hash,
            createdAt: now,
          })
          .run();
      });
    } catch {
      /* non-fatal */
    }
  }

  // Suggest the signer's name from the linked contact, if any.
  let suggestedName: string | null = null;
  if (request.contactId) {
    const [c] = await db
      .select({ firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, request.contactId))
      .limit(1);
    if (c) suggestedName = `${c.firstName} ${c.lastName}`.trim();
  }

  return (
    <SignFlow
      token={token}
      title={request.title}
      message={request.message}
      firmName={request.orgName}
      docName={request.docName}
      suggestedName={suggestedName}
    />
  );
}
