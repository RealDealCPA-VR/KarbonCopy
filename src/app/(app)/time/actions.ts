"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser, requireWrite, hasRole } from "@/lib/auth";
import { emitToUser } from "@/server/realtime";

const { timeEntries, workItems, activities, notifications } = schema;

// NOTE: a "use server" file may only export async functions, so the shared
// default rate constant lives in page.tsx / components, not here.

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function logActivity(opts: {
  actorId: string;
  verb: string;
  entityId: string;
  summary: string;
  meta?: Record<string, unknown>;
}) {
  await db.insert(activities).values({
    actorId: opts.actorId,
    verb: opts.verb,
    entityKind: "time_entry",
    entityId: opts.entityId,
    summary: opts.summary,
    meta: opts.meta,
  });
}

function clean(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toBool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true" || v === "1";
}

function toInt(v: FormDataEntryValue | null): number | null {
  const s = clean(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Parse a YYYY-MM-DD (local) date string into a Date at local midnight. */
function parseDateInput(v: FormDataEntryValue | null): Date {
  const s = clean(v);
  if (!s) return startOfDay(new Date());
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return startOfDay(new Date());
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function revalidate() {
  revalidatePath("/time");
}

/* Resolve the org for a work item so entries inherit a client link. */
async function orgForWorkItem(workItemId: string | null): Promise<string | null> {
  if (!workItemId) return null;
  const [w] = await db
    .select({ organizationId: workItems.organizationId })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);
  return w?.organizationId ?? null;
}

/* ------------------------------------------------------------------ */
/* Timer                                                              */
/* ------------------------------------------------------------------ */

/**
 * Start a live timer. Stops any other running timer for this user first
 * (only one running timer per user), then inserts a new running entry.
 */
export async function startTimer(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const workItemId = clean(form.get("workItemId"));
  const description = clean(form.get("description"));
  const billable = form.get("billable") == null ? true : toBool(form.get("billable"));
  const rateCents = toInt(form.get("rateCents"));
  const now = new Date();

  // Stop any timers already running for this user.
  await stopAllRunning(user.id, now);

  const organizationId = await orgForWorkItem(workItemId);

  const [row] = await db
    .insert(timeEntries)
    .values({
      userId: user.id,
      workItemId,
      organizationId,
      description,
      billable,
      rateCents,
      minutes: 0,
      date: startOfDay(now),
      startedAt: now,
      running: true,
    })
    .returning({ id: timeEntries.id });

  revalidate();
  return { ok: true, data: { id: row.id } };
}

/** Persist & stop the user's running timer, computing elapsed minutes. */
export async function stopTimer(id: string): Promise<ActionResult> {
  const user = await requireWrite();
  const now = new Date();
  const [entry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, user.id)))
    .limit(1);
  if (!entry) return { ok: false, error: "Timer not found." };
  if (!entry.running) return { ok: true };

  const base = entry.startedAt ?? now;
  const elapsed = Math.max(0, Math.round((now.getTime() - base.getTime()) / 60000));
  const minutes = entry.minutes + elapsed;

  await db
    .update(timeEntries)
    .set({ running: false, startedAt: null, minutes })
    .where(eq(timeEntries.id, id));

  await logActivity({
    actorId: user.id,
    verb: "tracked",
    entityId: id,
    summary: `${user.name} logged ${formatMins(minutes)} via timer`,
    meta: { minutes, workItemId: entry.workItemId },
  });

  revalidate();
  return { ok: true };
}

/** Discard a running timer entirely (no time saved). */
export async function cancelTimer(id: string): Promise<ActionResult> {
  const user = await requireWrite();
  await db
    .delete(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, user.id), eq(timeEntries.running, true)));
  revalidate();
  return { ok: true };
}

async function stopAllRunning(userId: string, now: Date) {
  const running = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), eq(timeEntries.running, true)));
  for (const r of running) {
    const base = r.startedAt ?? now;
    const elapsed = Math.max(0, Math.round((now.getTime() - base.getTime()) / 60000));
    await db
      .update(timeEntries)
      .set({ running: false, startedAt: null, minutes: r.minutes + elapsed })
      .where(eq(timeEntries.id, r.id));
  }
}

function formatMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ------------------------------------------------------------------ */
/* Manual timesheet entries                                          */
/* ------------------------------------------------------------------ */

/** Create or update a manual time entry for the current user. */
export async function upsertTimeEntry(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const id = clean(form.get("id"));
  const workItemId = clean(form.get("workItemId"));
  const description = clean(form.get("description"));
  const billable = toBool(form.get("billable"));
  const rateCents = toInt(form.get("rateCents"));
  const hours = Math.max(0, toInt(form.get("hours")) ?? 0);
  const mins = Math.max(0, Math.min(59, toInt(form.get("minutes")) ?? 0));
  const minutes = hours * 60 + mins;
  if (minutes <= 0) return { ok: false, error: "Enter a duration greater than zero." };

  const date = parseDateInput(form.get("date"));
  const organizationId =
    clean(form.get("organizationId")) ?? (await orgForWorkItem(workItemId));

  const values = {
    workItemId,
    organizationId,
    description,
    billable,
    rateCents,
    minutes,
    date,
  };

  let entryId: string;
  if (id) {
    // Only the owner may edit their own entry.
    const updated = await db
      .update(timeEntries)
      .set(values)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, user.id)))
      .returning({ id: timeEntries.id });
    if (!updated.length) return { ok: false, error: "Entry not found." };
    entryId = id;
  } else {
    const [row] = await db
      .insert(timeEntries)
      .values({ ...values, userId: user.id, running: false })
      .returning({ id: timeEntries.id });
    entryId = row.id;
  }

  await logActivity({
    actorId: user.id,
    verb: id ? "updated" : "tracked",
    entityId: entryId,
    summary: `${user.name} ${id ? "edited" : "logged"} ${formatMins(minutes)}`,
    meta: { minutes, workItemId },
  });

  revalidate();
  return { ok: true, data: { id: entryId } };
}

/** Delete one of the current user's time entries. */
export async function deleteTimeEntry(id: string): Promise<ActionResult> {
  const user = await requireWrite();
  const deleted = await db
    .delete(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, user.id), ne(timeEntries.running, true)))
    .returning({ id: timeEntries.id });
  if (!deleted.length) return { ok: false, error: "Entry not found or still running." };
  revalidate();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Approvals (manager+)                                              */
/* ------------------------------------------------------------------ */

export async function approveTimeEntries(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await requireUser();
  if (!hasRole(user, "manager")) return { ok: false, error: "Not authorized." };
  if (!ids.length) return { ok: false, error: "Nothing selected." };

  const rows = await db
    .update(timeEntries)
    .set({ approved: true })
    .where(and(inArray(timeEntries.id, ids), eq(timeEntries.running, false), eq(timeEntries.approved, false)))
    .returning({ id: timeEntries.id, userId: timeEntries.userId, minutes: timeEntries.minutes });

  // Notify each affected user once + log activity.
  const byUser = new Map<string, number>();
  for (const r of rows) {
    byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + 1);
    await logActivity({
      actorId: user.id,
      verb: "approved",
      entityId: r.id,
      summary: `${user.name} approved a time entry`,
    });
  }
  for (const [uid, count] of byUser) {
    if (uid === user.id) continue;
    const [notif] = await db
      .insert(notifications)
      .values({
        userId: uid,
        type: "system",
        title: "Time approved",
        body: `${count} time ${count === 1 ? "entry was" : "entries were"} approved`,
        entityKind: "time_entry",
      })
      .returning();
    emitToUser(uid, "notification", notif);
  }

  revalidate();
  return { ok: true, data: { count: rows.length } };
}

/** Re-open a previously approved entry (manager+). */
export async function unapproveTimeEntry(id: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!hasRole(user, "manager")) return { ok: false, error: "Not authorized." };
  await db.update(timeEntries).set({ approved: false }).where(eq(timeEntries.id, id));
  revalidate();
  return { ok: true };
}
