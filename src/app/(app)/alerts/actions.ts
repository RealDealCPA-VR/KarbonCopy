"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireWrite } from "@/lib/auth";

const { fileEvents, activities } = schema;

export type AlertActionResult = { ok: true } | { ok: false; error: string };

async function logActivity(actorId: string, verb: string, eventId: string, summary: string) {
  try {
    await db.insert(activities).values({
      actorId,
      verb,
      entityKind: "document",
      entityId: eventId,
      summary,
    });
  } catch {
    /* activity logging is best-effort */
  }
}

/** Acknowledge a single file event (or set it back to new). */
export async function acknowledgeEvent(eventId: string): Promise<AlertActionResult> {
  const user = await requireWrite();
  try {
    const [row] = await db.select().from(fileEvents).where(eq(fileEvents.id, eventId)).limit(1);
    if (!row) return { ok: false, error: "Alert not found" };

    await db
      .update(fileEvents)
      .set({
        status: "acknowledged",
        acknowledgedById: user.id,
        acknowledgedAt: new Date(),
      })
      .where(eq(fileEvents.id, eventId));

    await logActivity(user.id, "acknowledged", eventId, `Acknowledged file alert “${row.fileName}”`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to acknowledge alert." };
  }
  revalidatePath("/alerts");
  return { ok: true };
}

/** Dismiss a single file event. */
export async function dismissEvent(eventId: string): Promise<AlertActionResult> {
  const user = await requireWrite();
  try {
    const [row] = await db.select().from(fileEvents).where(eq(fileEvents.id, eventId)).limit(1);
    if (!row) return { ok: false, error: "Alert not found" };

    await db
      .update(fileEvents)
      .set({
        status: "dismissed",
        acknowledgedById: user.id,
        acknowledgedAt: new Date(),
      })
      .where(eq(fileEvents.id, eventId));

    await logActivity(user.id, "dismissed", eventId, `Dismissed file alert “${row.fileName}”`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to dismiss alert." };
  }
  revalidatePath("/alerts");
  return { ok: true };
}

/** Restore a dismissed/acknowledged event back to "new". */
export async function restoreEvent(eventId: string): Promise<AlertActionResult> {
  const user = await requireWrite();
  try {
    const [row] = await db.select().from(fileEvents).where(eq(fileEvents.id, eventId)).limit(1);
    if (!row) return { ok: false, error: "Alert not found" };
    await db
      .update(fileEvents)
      .set({ status: "new", acknowledgedById: null, acknowledgedAt: null })
      .where(eq(fileEvents.id, eventId));
    await logActivity(user.id, "updated", eventId, `Restored file alert “${row.fileName}”`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to restore alert." };
  }
  revalidatePath("/alerts");
  return { ok: true };
}

/** Bulk acknowledge every currently-new alert. */
export async function acknowledgeAllNew(): Promise<AlertActionResult> {
  const user = await requireWrite();
  try {
    const rows = await db
      .select({ id: fileEvents.id })
      .from(fileEvents)
      .where(eq(fileEvents.status, "new"));
    if (rows.length === 0) return { ok: true };

    await db
      .update(fileEvents)
      .set({ status: "acknowledged", acknowledgedById: user.id, acknowledgedAt: new Date() })
      .where(
        inArray(
          fileEvents.id,
          rows.map((r) => r.id),
        ),
      );

    await logActivity(
      user.id,
      "acknowledged",
      "bulk",
      `Acknowledged ${rows.length} new file alert${rows.length === 1 ? "" : "s"}`,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to acknowledge alerts." };
  }
  revalidatePath("/alerts");
  return { ok: true };
}
