import { desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { DocumentRequests } from "@/components/documents/document-requests";
import type { OrgLite } from "@/components/documents/types";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function DocumentRequestsPage() {
  await requireUser();

  const [requests, orgs, contacts] = await Promise.all([
    db
      .select({
        id: schema.documentRequests.id,
        title: schema.documentRequests.title,
        message: schema.documentRequests.message,
        organizationId: schema.documentRequests.organizationId,
        contactId: schema.documentRequests.contactId,
        items: schema.documentRequests.items,
        status: schema.documentRequests.status,
        magicToken: schema.documentRequests.magicToken,
        expiresAt: schema.documentRequests.expiresAt,
        createdAt: schema.documentRequests.createdAt,
        orgName: schema.organizations.name,
      })
      .from(schema.documentRequests)
      .leftJoin(schema.organizations, eq(schema.documentRequests.organizationId, schema.organizations.id))
      .orderBy(desc(schema.documentRequests.createdAt)),
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
  ]);

  return (
    <DocumentRequests
      requests={requests as never}
      orgs={orgs as OrgLite[]}
      contacts={contacts}
      appUrl={APP_URL}
    />
  );
}
