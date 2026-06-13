import { desc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser, hasRole } from "@/lib/auth";
import { DocumentsBrowser } from "@/components/documents/documents-browser";
import type { DocRow, FolderLite, OrgLite } from "@/components/documents/types";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; folder?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  // Non-managers only see documents they uploaded or that belong to an org they
  // own (relationship manager). Managers+ see everything. Mirrors the per-doc
  // authorization on the download route so the list never shows undownloadable rows.
  const docScope = hasRole(user, "manager")
    ? undefined
    : or(
        eq(schema.documents.uploadedById, user.id),
        eq(schema.organizations.ownerId, user.id),
      );

  const [orgs, folderRows, docRows] = await Promise.all([
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(schema.organizations.name),
    db
      .select({
        id: schema.folders.id,
        name: schema.folders.name,
        parentId: schema.folders.parentId,
        organizationId: schema.folders.organizationId,
      })
      .from(schema.folders)
      .orderBy(schema.folders.name),
    db
      .select({
        id: schema.documents.id,
        name: schema.documents.name,
        folderId: schema.documents.folderId,
        organizationId: schema.documents.organizationId,
        workItemId: schema.documents.workItemId,
        storagePath: schema.documents.storagePath,
        mimeType: schema.documents.mimeType,
        sizeBytes: schema.documents.sizeBytes,
        version: schema.documents.version,
        uploadedById: schema.documents.uploadedById,
        source: schema.documents.source,
        createdAt: schema.documents.createdAt,
        orgName: schema.organizations.name,
        uploaderName: schema.users.name,
        workTitle: schema.workItems.title,
      })
      .from(schema.documents)
      .leftJoin(schema.organizations, eq(schema.documents.organizationId, schema.organizations.id))
      .leftJoin(schema.users, eq(schema.documents.uploadedById, schema.users.id))
      .leftJoin(schema.workItems, eq(schema.documents.workItemId, schema.workItems.id))
      .where(docScope)
      .orderBy(desc(schema.documents.createdAt)),
  ]);

  return (
    <DocumentsBrowser
      orgs={orgs as OrgLite[]}
      folders={folderRows as FolderLite[]}
      documents={docRows as DocRow[]}
      initialClient={sp.client ?? null}
      initialFolder={sp.folder ?? null}
    />
  );
}
