"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import type { DocType } from "@/lib/ocr";

const { documentExtractions, documentRequests, activities } = schema;

export type IntakeActionResult = { ok: true } | { ok: false; error: string };

async function logActivity(actorId: string, verb: string, id: string, summary: string) {
  try {
    await db.insert(activities).values({
      actorId,
      verb,
      entityKind: "document",
      entityId: id,
      summary,
    });
  } catch {
    /* best-effort */
  }
}

/** Staff correction of the detected docType. Sets confidence to 1 (human-verified). */
export async function correctDocType(
  extractionId: string,
  docType: DocType,
): Promise<IntakeActionResult> {
  const user = await requireWrite();
  const [row] = await db
    .select()
    .from(documentExtractions)
    .where(eq(documentExtractions.id, extractionId))
    .limit(1);
  if (!row) return { ok: false, error: "Extraction not found." };

  try {
    await db
      .update(documentExtractions)
      .set({ docType, confidence: 1 })
      .where(eq(documentExtractions.id, extractionId));
    await logActivity(user.id, "updated", extractionId, `${user.name} corrected doc type to ${docType}`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update doc type." };
  }
  revalidatePath("/intake");
  return { ok: true };
}

/**
 * Confirm/override the match: link the extraction to a request and fulfil the
 * given item label. Pass requestId === "" to clear the match.
 */
export async function confirmMatch(
  extractionId: string,
  requestId: string,
  itemLabel?: string,
): Promise<IntakeActionResult> {
  const user = await requireWrite();
  const [ext] = await db
    .select()
    .from(documentExtractions)
    .where(eq(documentExtractions.id, extractionId))
    .limit(1);
  if (!ext) return { ok: false, error: "Extraction not found." };

  // Clearing the match.
  if (!requestId) {
    try {
      await db
        .update(documentExtractions)
        .set({ status: "processed", matchedRequestId: null, matchedWorkItemId: null })
        .where(eq(documentExtractions.id, extractionId));
      await logActivity(user.id, "updated", extractionId, `${user.name} cleared the auto-match`);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to clear match." };
    }
    revalidatePath("/intake");
    return { ok: true };
  }

  const [req] = await db
    .select()
    .from(documentRequests)
    .where(eq(documentRequests.id, requestId))
    .limit(1);
  if (!req) return { ok: false, error: "Document request not found." };

  // Fulfil the matching (or named) item, in a transaction with the extraction link.
  const items = Array.isArray(req.items) ? req.items : [];
  let idx = itemLabel ? items.findIndex((it) => it.label === itemLabel) : -1;
  if (idx === -1) idx = items.findIndex((it) => !it.fulfilled);
  const nextItems = items.map((it, i) =>
    i === idx ? { ...it, fulfilled: true, documentId: ext.documentId ?? it.documentId } : it,
  );
  const allDone = nextItems.length > 0 && nextItems.every((it) => it.fulfilled);

  try {
    db.transaction((tx) => {
    tx.update(documentRequests)
      .set({ items: nextItems, status: allDone ? "fulfilled" : "partial" })
      .where(eq(documentRequests.id, requestId))
      .run();
    tx.update(documentExtractions)
      .set({
        status: "matched",
        matchedRequestId: requestId,
        matchedWorkItemId: req.workItemId ?? null,
        organizationId: ext.organizationId ?? req.organizationId ?? null,
      })
      .where(eq(documentExtractions.id, extractionId))
      .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to confirm match." };
  }

  await logActivity(
    user.id,
    "matched",
    extractionId,
    `${user.name} matched the document to request “${req.title}”`,
  );
  revalidatePath("/intake");
  return { ok: true };
}

/** Re-queue a failed/skipped extraction for processing. */
export async function reprocess(extractionId: string): Promise<IntakeActionResult> {
  const user = await requireWrite();
  const [row] = await db
    .select()
    .from(documentExtractions)
    .where(eq(documentExtractions.id, extractionId))
    .limit(1);
  if (!row) return { ok: false, error: "Extraction not found." };

  try {
    // Dynamic import keeps the server-only pipeline out of the action module graph
    // until actually needed.
    const { processDocument } = await import("@/server/ocr");
    // Mark pending immediately for UI feedback, then fire the pipeline.
    await db
      .update(documentExtractions)
      .set({ status: "pending", error: null })
      .where(eq(documentExtractions.id, extractionId));
    await logActivity(user.id, "reprocessed", extractionId, `${user.name} requeued a document for processing`);

    void processDocument({
      sourcePath: row.sourcePath,
      fileEventId: row.fileEventId,
      documentId: row.documentId,
      organizationId: row.organizationId,
    }).catch(() => {});
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reprocess." };
  }

  revalidatePath("/intake");
  return { ok: true };
}

/** Dismiss an extraction from the queue (soft: mark failed with a note). */
export async function dismissExtraction(extractionId: string): Promise<IntakeActionResult> {
  const user = await requireWrite();
  try {
    await db
      .update(documentExtractions)
      .set({ status: "failed", error: "Dismissed by staff" })
      .where(eq(documentExtractions.id, extractionId));
    await logActivity(user.id, "dismissed", extractionId, `${user.name} dismissed an intake item`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to dismiss item." };
  }
  revalidatePath("/intake");
  return { ok: true };
}
