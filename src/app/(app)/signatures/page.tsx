import { desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { SignaturesView } from "@/components/signatures/signatures-view";
import type { SigRow, OrgLite, ContactLite, DocLite } from "@/components/signatures/types";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function SignaturesPage() {
  await requireUser();

  const [requests, orgs, contacts, docs] = await Promise.all([
    db
      .select({
        id: schema.signatureRequests.id,
        title: schema.signatureRequests.title,
        message: schema.signatureRequests.message,
        organizationId: schema.signatureRequests.organizationId,
        contactId: schema.signatureRequests.contactId,
        documentId: schema.signatureRequests.documentId,
        status: schema.signatureRequests.status,
        magicToken: schema.signatureRequests.magicToken,
        signerName: schema.signatureRequests.signerName,
        signedDocumentPath: schema.signatureRequests.signedDocumentPath,
        signedAt: schema.signatureRequests.signedAt,
        expiresAt: schema.signatureRequests.expiresAt,
        createdAt: schema.signatureRequests.createdAt,
        orgName: schema.organizations.name,
        docName: schema.documents.name,
      })
      .from(schema.signatureRequests)
      .leftJoin(
        schema.organizations,
        eq(schema.signatureRequests.organizationId, schema.organizations.id),
      )
      .leftJoin(schema.documents, eq(schema.signatureRequests.documentId, schema.documents.id))
      .orderBy(desc(schema.signatureRequests.createdAt)),
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(schema.organizations.name),
    db
      .select({
        id: schema.contacts.id,
        firstName: schema.contacts.firstName,
        lastName: schema.contacts.lastName,
        organizationId: schema.contacts.organizationId,
      })
      .from(schema.contacts)
      .where(isNull(schema.contacts.deletedAt)),
    db
      .select({
        id: schema.documents.id,
        name: schema.documents.name,
        mimeType: schema.documents.mimeType,
        organizationId: schema.documents.organizationId,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .orderBy(desc(schema.documents.createdAt))
      .limit(200),
  ]);

  // Only offer PDFs in the source-document picker.
  const pdfDocs = (docs as DocLite[]).filter(
    (d) => (d.mimeType && d.mimeType.includes("pdf")) || d.name.toLowerCase().endsWith(".pdf"),
  );

  return (
    <SignaturesView
      requests={requests as SigRow[]}
      orgs={orgs as OrgLite[]}
      contacts={contacts as ContactLite[]}
      docs={pdfDocs}
      appUrl={APP_URL}
    />
  );
}
