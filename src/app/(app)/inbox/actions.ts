"use server";

import { revalidatePath } from "next/cache";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { emitToUser } from "@/server/realtime";
import type { ThreadStatus } from "@/db/schema";

const { inboxThreads, messages, workItems, workTasks, workStatuses, activities, notifications } =
  schema;

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
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
    entityKind: "thread",
    entityId: opts.entityId,
    summary: opts.summary,
    meta: opts.meta,
  });
}

function clean(v: FormDataEntryValue | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function nullable(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  if (!s || s === "none") return null;
  return s;
}

async function getThread(id: string) {
  const [t] = await db.select().from(inboxThreads).where(eq(inboxThreads.id, id)).limit(1);
  return t ?? null;
}

function revalidateInbox(threadId?: string) {
  revalidatePath("/inbox");
  if (threadId) revalidatePath(`/inbox?thread=${threadId}`);
}

/* ------------------------------------------------------------------ */
/* New thread (demo-friendly: inbox + first inbound message)         */
/* ------------------------------------------------------------------ */

export async function createThread(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const subject = clean(form.get("subject"));
  const body = clean(form.get("body"));
  const fromName = clean(form.get("fromName"));
  const fromEmail = clean(form.get("fromEmail"));
  if (!subject) return { ok: false, error: "Subject is required." };
  if (!body) return { ok: false, error: "Message body is required." };

  const organizationId = nullable(clean(form.get("organizationId")));
  const contactId = nullable(clean(form.get("contactId")));
  const now = new Date();

  // Thread + first message must be atomic so a failed message insert can't leave
  // an orphaned thread. better-sqlite3 tx callbacks must be synchronous.
  let threadId: string;
  try {
    threadId = db.transaction((tx) => {
      const [t] = tx
        .insert(inboxThreads)
        .values({
          subject,
          status: "open",
          organizationId,
          contactId,
          lastMessageAt: now,
        })
        .returning({ id: inboxThreads.id })
        .all();
      if (!t) throw new Error("Thread could not be created.");
      tx.insert(messages)
        .values({
          threadId: t.id,
          fromName,
          fromEmail,
          body,
          direction: "inbound",
        })
        .run();
      return t.id;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create thread." };
  }

  try {
    await logActivity({
      actorId: user.id,
      verb: "created",
      entityId: threadId,
      summary: `${user.name} logged a new thread "${subject}"`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create thread." };
  }

  revalidateInbox(threadId);
  return { ok: true, data: { id: threadId } };
}

/* ------------------------------------------------------------------ */
/* Assign                                                            */
/* ------------------------------------------------------------------ */

export async function assignThread(
  threadId: string,
  assigneeId: string | null,
): Promise<ActionResult> {
  const user = await requireWrite();
  try {
    const thread = await getThread(threadId);
    if (!thread) return { ok: false, error: "Thread not found." };

    const next = nullable(assigneeId);
    // Assigning bumps an "open" thread to "assigned"; clearing reverts to "open".
    let status: ThreadStatus = thread.status;
    if (next && thread.status === "open") status = "assigned";
    if (!next && thread.status === "assigned") status = "open";

    await db
      .update(inboxThreads)
      .set({ assigneeId: next, status })
      .where(eq(inboxThreads.id, threadId));

    await logActivity({
      actorId: user.id,
      verb: "assigned",
      entityId: threadId,
      summary: next
        ? `${user.name} assigned thread "${thread.subject}"`
        : `${user.name} unassigned thread "${thread.subject}"`,
      meta: { assigneeId: next },
    });

    if (next && next !== user.id) {
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: next,
          type: "assignment",
          title: "A thread was assigned to you",
          body: thread.subject,
          entityKind: "thread",
          entityId: threadId,
        })
        .returning();
      if (notif) emitToUser(next, "notification", notif);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to assign thread." };
  }

  revalidateInbox(threadId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Status                                                            */
/* ------------------------------------------------------------------ */

export async function setThreadStatus(
  threadId: string,
  status: ThreadStatus,
): Promise<ActionResult> {
  const user = await requireWrite();
  try {
    const thread = await getThread(threadId);
    if (!thread) return { ok: false, error: "Thread not found." };

    await db.update(inboxThreads).set({ status }).where(eq(inboxThreads.id, threadId));

    await logActivity({
      actorId: user.id,
      verb: "updated",
      entityId: threadId,
      summary: `${user.name} marked "${thread.subject}" as ${status}`,
      meta: { status },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update thread status." };
  }

  revalidateInbox(threadId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Link client / contact / work item                                */
/* ------------------------------------------------------------------ */

export async function linkThread(
  threadId: string,
  links: { organizationId?: string | null; contactId?: string | null; workItemId?: string | null },
): Promise<ActionResult> {
  const user = await requireWrite();
  try {
    const thread = await getThread(threadId);
    if (!thread) return { ok: false, error: "Thread not found." };

    const patch: Partial<typeof schema.inboxThreads.$inferInsert> = {};
    if ("organizationId" in links) patch.organizationId = nullable(links.organizationId);
    if ("contactId" in links) patch.contactId = nullable(links.contactId);
    if ("workItemId" in links) patch.workItemId = nullable(links.workItemId);
    if (Object.keys(patch).length === 0) return { ok: true };

    await db.update(inboxThreads).set(patch).where(eq(inboxThreads.id, threadId));

    await logActivity({
      actorId: user.id,
      verb: "updated",
      entityId: threadId,
      summary: `${user.name} updated links on "${thread.subject}"`,
      meta: patch,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update thread links." };
  }

  revalidateInbox(threadId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Reply / note composer                                            */
/* ------------------------------------------------------------------ */

export async function addMessage(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireWrite();
  const threadId = clean(form.get("threadId"));
  const body = clean(form.get("body"));
  const direction = (clean(form.get("direction")) ?? "outbound") as
    | "inbound"
    | "outbound"
    | "note";
  if (!threadId) return { ok: false, error: "Missing thread." };
  if (!body) return { ok: false, error: "Message cannot be empty." };

  let thread;
  try {
    thread = await getThread(threadId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load thread." };
  }
  if (!thread) return { ok: false, error: "Thread not found." };

  const now = new Date();
  // Insert the message and bump the thread's lastMessageAt atomically.
  let row: { id: string };
  try {
    row = db.transaction((tx) => {
    const [inserted] = tx
      .insert(messages)
      .values({
        threadId,
        body,
        direction,
        toEmail: clean(form.get("toEmail")),
        fromName: user.name,
        fromEmail: direction === "note" ? null : user.email,
        sentById: user.id,
      })
      .returning({ id: messages.id })
      .all();
    if (!inserted) throw new Error("Message could not be created.");

    tx.update(inboxThreads).set({ lastMessageAt: now }).where(eq(inboxThreads.id, threadId)).run();
    return inserted;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add message." };
  }

  try {
    await logActivity({
      actorId: user.id,
      verb: direction === "note" ? "commented" : "replied",
      entityId: threadId,
      summary:
        direction === "note"
          ? `${user.name} added an internal note to "${thread.subject}"`
          : `${user.name} replied to "${thread.subject}"`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add message." };
  }

  revalidateInbox(threadId);
  return { ok: true, data: { id: row.id } };
}

/* ------------------------------------------------------------------ */
/* Convert thread → work item                                       */
/* ------------------------------------------------------------------ */

export async function convertThreadToWork(
  threadId: string,
  opts?: { title?: string | null; assigneeId?: string | null },
): Promise<ActionResult<{ workItemId: string }>> {
  const user = await requireWrite();
  let thread;
  let firstStatus;
  try {
    thread = await getThread(threadId);
    if (!thread) return { ok: false, error: "Thread not found." };
    if (thread.workItemId) {
      return { ok: false, error: "This thread is already linked to a work item." };
    }

    // Default status = first board column by position.
    [firstStatus] = await db
      .select({ id: workStatuses.id })
      .from(workStatuses)
      .orderBy(asc(workStatuses.position))
      .limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load thread." };
  }

  const title = nullable(opts?.title) ?? thread.subject;
  const assigneeId = nullable(opts?.assigneeId) ?? thread.assigneeId ?? null;

  // Create the work item, link it to the thread, and log the activity atomically.
  let work: { id: string };
  try {
    work = db.transaction((tx) => {
    const [created] = tx
      .insert(workItems)
      .values({
        title,
        description: `Created from inbox thread "${thread.subject}".`,
        statusId: firstStatus?.id ?? null,
        organizationId: thread.organizationId ?? null,
        contactId: thread.contactId ?? null,
        assigneeId,
      })
      .returning({ id: workItems.id })
      .all();
    if (!created) throw new Error("Work item could not be created.");

    tx.update(inboxThreads).set({ workItemId: created.id }).where(eq(inboxThreads.id, threadId)).run();

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "created",
        entityKind: "thread",
        entityId: threadId,
        summary: `${user.name} converted "${thread.subject}" into a work item`,
        meta: { workItemId: created.id },
      })
      .run();

    return created;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to convert thread." };
  }

  if (assigneeId && assigneeId !== user.id) {
    try {
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: assigneeId,
          type: "assignment",
          title: "New work assigned to you",
          body: title,
          entityKind: "work_item",
          entityId: work.id,
        })
        .returning();
      if (notif) emitToUser(assigneeId, "notification", notif);
    } catch (err) {
      // Work item is already committed; a notification failure must not undo it.
      console.error("[inbox] convert notification failed:", err instanceof Error ? err.message : err);
    }
  }

  revalidateInbox(threadId);
  revalidatePath("/work");
  return { ok: true, data: { workItemId: work.id } };
}

/* ------------------------------------------------------------------ */
/* Add extracted tasks → workTasks (when a work item is linked)     */
/* ------------------------------------------------------------------ */

export async function addTasksToThreadWork(
  threadId: string,
  tasks: string[],
): Promise<ActionResult<{ count: number }>> {
  const user = await requireWrite();
  let thread;
  try {
    thread = await getThread(threadId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load thread." };
  }
  if (!thread) return { ok: false, error: "Thread not found." };
  if (!thread.workItemId) {
    return { ok: false, error: "Link a work item first, then add tasks." };
  }
  const workItemId = thread.workItemId;
  const titles = tasks.map((t) => t.trim()).filter(Boolean);
  if (!titles.length) return { ok: false, error: "No tasks to add." };

  let pos: number;
  // Bulk-insert the tasks and log the activity atomically.
  try {
    const existing = await db
      .select({ value: workTasks.position })
      .from(workTasks)
      .where(eq(workTasks.workItemId, workItemId))
      .orderBy(desc(workTasks.position))
      .limit(1);

    pos = (existing[0]?.value ?? 0) + 1;
    db.transaction((tx) => {
    tx.insert(workTasks)
      .values(
        titles.map((title) => ({
          workItemId,
          title,
          section: "From inbox",
          position: pos++,
        })),
      )
      .run();

    tx.insert(activities)
      .values({
        actorId: user.id,
        verb: "updated",
        entityKind: "thread",
        entityId: threadId,
        summary: `${user.name} added ${titles.length} task${titles.length === 1 ? "" : "s"} from "${thread.subject}"`,
        meta: { workItemId, count: titles.length },
      })
      .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add tasks." };
  }

  revalidatePath(`/work/${workItemId}`);
  revalidateInbox(threadId);
  return { ok: true, data: { count: titles.length } };
}
