"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { scanTransactions } from "@/lib/anomaly/scan";
import { generateSampleTxns, sampleReconciliationConfig } from "@/lib/anomaly/sample";
import type { ScanSummary } from "@/lib/anomaly/scan";

const { anomalies, activities } = schema;

export type AnomalyActionResult = { ok: true } | { ok: false; error: string };

async function logActivity(actorId: string, verb: string, anomalyId: string, summary: string) {
  try {
    await db.insert(activities).values({
      actorId,
      verb,
      entityKind: "anomaly",
      entityId: anomalyId,
      summary,
    });
  } catch {
    /* best-effort */
  }
}

/** Mark an anomaly reviewed (handled / acknowledged as a real issue). */
export async function reviewAnomaly(id: string): Promise<AnomalyActionResult> {
  const user = await requireWrite();
  try {
    const [row] = await db.select().from(anomalies).where(eq(anomalies.id, id)).limit(1);
    if (!row) return { ok: false, error: "Anomaly not found" };

    await db
      .update(anomalies)
      .set({ status: "reviewed", reviewedById: user.id })
      .where(eq(anomalies.id, id));

    await logActivity(user.id, "reviewed", id, `Reviewed anomaly “${row.title}”`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to review anomaly." };
  }
  revalidatePath("/anomalies");
  return { ok: true };
}

/** Dismiss an anomaly (false positive / not actionable). */
export async function dismissAnomaly(id: string): Promise<AnomalyActionResult> {
  const user = await requireWrite();
  try {
    const [row] = await db.select().from(anomalies).where(eq(anomalies.id, id)).limit(1);
    if (!row) return { ok: false, error: "Anomaly not found" };

    await db
      .update(anomalies)
      .set({ status: "dismissed", reviewedById: user.id })
      .where(eq(anomalies.id, id));

    await logActivity(user.id, "dismissed", id, `Dismissed anomaly “${row.title}”`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to dismiss anomaly." };
  }
  revalidatePath("/anomalies");
  return { ok: true };
}

/** Re-open a reviewed/dismissed anomaly. */
export async function reopenAnomaly(id: string): Promise<AnomalyActionResult> {
  const user = await requireWrite();
  try {
    const [row] = await db.select().from(anomalies).where(eq(anomalies.id, id)).limit(1);
    if (!row) return { ok: false, error: "Anomaly not found" };
    await db
      .update(anomalies)
      .set({ status: "open", reviewedById: null })
      .where(eq(anomalies.id, id));
    await logActivity(user.id, "updated", id, "Re-opened anomaly");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reopen anomaly." };
  }
  revalidatePath("/anomalies");
  return { ok: true };
}

/** Bulk-resolve every currently-open anomaly for one org (or all). */
export async function reviewAllOpen(organizationId?: string): Promise<AnomalyActionResult> {
  const user = await requireWrite();
  try {
    const rows = await db
      .select({ id: anomalies.id })
      .from(anomalies)
      .where(eq(anomalies.status, "open"));
    let ids = rows.map((r) => r.id);
    if (organizationId) {
      const scoped = await db
        .select({ id: anomalies.id })
        .from(anomalies)
        .where(eq(anomalies.organizationId, organizationId));
      const scopedSet = new Set(scoped.map((r) => r.id));
      ids = ids.filter((id) => scopedSet.has(id));
    }
    if (ids.length === 0) return { ok: true };

    await db
      .update(anomalies)
      .set({ status: "reviewed", reviewedById: user.id })
      .where(inArray(anomalies.id, ids));
    await logActivity(user.id, "reviewed", ids[0], `Reviewed ${ids.length} open anomalies`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to review anomalies." };
  }
  revalidatePath("/anomalies");
  return { ok: true };
}

/**
 * Run a scan for a client. Used by the "Run scan" button in the cockpit. With no
 * transactions wired up yet this generates a sample month of books so the radar is
 * demoable; the live QB bridge will call `scanTransactions` with real data instead.
 */
export async function runScan(
  organizationId: string,
): Promise<{ ok: true; summary: ScanSummary } | { ok: false; error: string }> {
  const user = await requireWrite();
  if (!organizationId) return { ok: false, error: "Pick a client to scan" };

  let summary: ScanSummary;
  try {
    const txns = generateSampleTxns(organizationId);
    summary = await scanTransactions(organizationId, txns, {
      source: "quickbooks",
      config: sampleReconciliationConfig(txns),
      actorId: user.id,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Books scan failed." };
  }
  revalidatePath("/anomalies");
  return { ok: true, summary };
}
