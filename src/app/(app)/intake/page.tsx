import { basename } from "node:path";
import { desc, eq, inArray } from "drizzle-orm";
import { ScanLine } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { IntakeQueue } from "@/components/intake/intake-queue";
import { IntakeStats } from "@/components/intake/intake-stats";
import type { IntakeItem, OpenRequest } from "@/components/intake/types";
import type { DocType } from "@/lib/ocr";

export const dynamic = "force-dynamic";

const { documentExtractions, organizations, documentRequests } = schema;

export default async function IntakePage() {
  await requireUser();

  const rows = await db
    .select({
      id: documentExtractions.id,
      sourcePath: documentExtractions.sourcePath,
      docType: documentExtractions.docType,
      confidence: documentExtractions.confidence,
      status: documentExtractions.status,
      extractedFields: documentExtractions.extractedFields,
      organizationId: documentExtractions.organizationId,
      matchedRequestId: documentExtractions.matchedRequestId,
      engine: documentExtractions.engine,
      error: documentExtractions.error,
      createdAt: documentExtractions.createdAt,
      processedAt: documentExtractions.processedAt,
      clientName: organizations.name,
      matchedRequestTitle: documentRequests.title,
    })
    .from(documentExtractions)
    .leftJoin(organizations, eq(documentExtractions.organizationId, organizations.id))
    .leftJoin(documentRequests, eq(documentExtractions.matchedRequestId, documentRequests.id))
    .orderBy(desc(documentExtractions.createdAt))
    .limit(150);

  const items: IntakeItem[] = rows.map((r) => ({
    id: r.id,
    sourcePath: r.sourcePath,
    fileName: basename(r.sourcePath),
    docType: (r.docType as DocType) ?? null,
    confidence: r.confidence,
    status: r.status,
    extractedFields: (r.extractedFields as Record<string, unknown> | null) ?? null,
    organizationId: r.organizationId,
    clientName: r.clientName,
    matchedRequestId: r.matchedRequestId,
    matchedRequestTitle: r.matchedRequestTitle,
    engine: r.engine,
    error: r.error,
    createdAt: r.createdAt,
    processedAt: r.processedAt,
  }));

  // open/partial requests for the manual-match picker
  const reqRows = await db
    .select({
      id: documentRequests.id,
      title: documentRequests.title,
      organizationId: documentRequests.organizationId,
      items: documentRequests.items,
    })
    .from(documentRequests)
    .where(inArray(documentRequests.status, ["open", "partial"]))
    .orderBy(desc(documentRequests.createdAt))
    .limit(200);

  const openRequests: OpenRequest[] = reqRows.map((r) => ({
    id: r.id,
    title: r.title,
    organizationId: r.organizationId,
    items: Array.isArray(r.items) ? r.items : [],
  }));

  // distinct clients for the filter
  const clientMap = new Map<string, string>();
  for (const i of items) if (i.organizationId && i.clientName) clientMap.set(i.organizationId, i.clientName);
  const clients = [...clientMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const stats = {
    pending: items.filter((i) => i.status === "pending" || i.status === "processing").length,
    processed: items.filter((i) => i.status === "processed").length,
    matched: items.filter((i) => i.status === "matched").length,
    needsReview: items.filter(
      (i) => i.status === "processed" && (i.docType === "unknown" || (i.confidence ?? 0) < 0.6),
    ).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ScanLine className="h-6 w-6 text-primary" />
            Autonomous Intake
          </h1>
          <p className="text-muted-foreground">
            On-prem OCR reads, classifies, and auto-files every document the moment it lands —
            no client data ever leaves the building.
          </p>
        </div>
      </div>

      <IntakeStats stats={stats} />

      <IntakeQueue initial={items} openRequests={openRequests} clients={clients} />
    </div>
  );
}
