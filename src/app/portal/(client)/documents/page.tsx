import { desc, eq } from "drizzle-orm";
import { FileBox, Download } from "lucide-react";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { PortalHeader } from "@/components/portal-client/portal-header";
import { guardPortal } from "../_guard";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function isUncPath(p: string): boolean {
  return p.includes(":") || p.startsWith("\\\\");
}

export default async function PortalDocumentsPage() {
  const { contact, organization } = await guardPortal();
  const orgId = organization?.id;

  const docs = orgId
    ? await db
        .select({
          id: schema.documents.id,
          name: schema.documents.name,
          mimeType: schema.documents.mimeType,
          sizeBytes: schema.documents.sizeBytes,
          createdAt: schema.documents.createdAt,
          storagePath: schema.documents.storagePath,
        })
        .from(schema.documents)
        .where(eq(schema.documents.organizationId, orgId))
        .orderBy(desc(schema.documents.createdAt))
    : [];

  return (
    <div className="min-h-screen">
      <PortalHeader
        firmName={organization?.name}
        clientName={`${contact.firstName} ${contact.lastName}`.trim()}
        active="documents"
      />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Files shared between you and your accounting firm.
          </p>
        </div>

        {docs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/50 p-12 text-center">
            <FileBox className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No documents yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              When your firm shares documents or you upload requested files, they&apos;ll appear
              here.
            </p>
          </div>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {docs.map((doc) => {
              const downloadable = !isUncPath(doc.storagePath);
              return (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <FileBox className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.createdAt ? format(doc.createdAt, "MMM d, yyyy") : ""}
                      {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""}
                    </p>
                  </div>
                  {downloadable ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={`/api/portal/documents/${doc.id}`}>
                        <Download className="h-4 w-4" /> Download
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not downloadable</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
