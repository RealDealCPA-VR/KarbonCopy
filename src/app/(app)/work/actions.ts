"use server";

import { and, asc, count, eq, isNull, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireWrite, requireManager } from "@/lib/auth";
import { broadcast, emitToUser } from "@/server/realtime";
import { runStatusChangedAutomators, runAutomators } from "./automators";
import type { WorkPriority } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function logActivity(
  actorId: string | null,
  verb: string,
  entityId: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(schema.activities).values({
    actorId,
    verb,
    entityKind: "work_item",
    entityId,
    summary,
    meta,
  });
}

async function notifyAssignee(opts: {
  assigneeId: string;
  actorName: string;
  workItemId: string;
  workTitle: string;
  verb: "assigned" | "reassigned";
}) {
  const [notif] = await db
    .insert(schema.notifications)
    .values({
      userId: opts.assigneeId,
      type: "assignment",
      title: `${opts.actorName} ${opts.verb} you work`,
      body: opts.workTitle,
      entityKind: "work_item",
      entityId: opts.workItemId,
    })
    .returning();
  if (notif) emitToUser(opts.assigneeId, "notification", notif);
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIntOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

/* ------------------------------------------------------------------ */
/* Create / update work items                                         */
/* ------------------------------------------------------------------ */

export type WorkItemInput = {
  id?: string;
  title: string;
  description?: string | null;
  workTypeId?: string | null;
  statusId?: string | null;
  priority?: WorkPriority;
  organizationId?: string | null;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  budgetMinutes?: string | number | null;
};

export async function saveWorkItem(input: WorkItemInput) {
  const user = await requireWrite();
  const title = input.title?.trim();
  if (!title) throw new Error("Title is required");

  const values = {
    title,
    description: input.description?.trim() || null,
    workTypeId: input.workTypeId || null,
    statusId: input.statusId || null,
    priority: input.priority ?? "normal",
    organizationId: input.organizationId || null,
    assigneeId: input.assigneeId || null,
    startDate: toDate(input.startDate),
    dueDate: toDate(input.dueDate),
    budgetMinutes: toIntOrNull(input.budgetMinutes ?? null),
  };

  if (input.id) {
    const [prev] = await db
      .select()
      .from(schema.workItems)
      .where(eq(schema.workItems.id, input.id))
      .limit(1);
    if (!prev) throw new Error("Work item not found");

    await db
      .update(schema.workItems)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.workItems.id, input.id));

    await logActivity(user.id, "updated", input.id, `${user.name} updated "${title}"`);

    if (values.assigneeId && values.assigneeId !== prev.assigneeId) {
      await notifyAssignee({
        assigneeId: values.assigneeId,
        actorName: user.name,
        workItemId: input.id,
        workTitle: title,
        verb: "reassigned",
      });
    }
    broadcast("work_updated", { id: input.id });
    revalidatePath("/work");
    revalidatePath(`/work/${input.id}`);
    return input.id;
  }

  // New item: append to the bottom of its status column.
  const [{ value: maxPos } = { value: null }] = await db
    .select({ value: max(schema.workItems.boardPosition) })
    .from(schema.workItems)
    .where(values.statusId ? eq(schema.workItems.statusId, values.statusId) : isNull(schema.workItems.statusId));

  const [created] = await db
    .insert(schema.workItems)
    .values({ ...values, boardPosition: (maxPos ?? 0) + 1 })
    .returning();
  if (!created) throw new Error("Work item could not be created.");

  await logActivity(user.id, "created", created.id, `${user.name} created "${title}"`);

  if (created.assigneeId) {
    await notifyAssignee({
      assigneeId: created.assigneeId,
      actorName: user.name,
      workItemId: created.id,
      workTitle: title,
      verb: "assigned",
    });
  }
  // Fire work_created automators (resilient).
  try {
    await runAutomators("work_created", { actorId: user.id, workItemId: created.id });
  } catch (err) {
    console.error("[automators] work_created failed:", err);
  }
  broadcast("work_updated", { id: created.id });
  revalidatePath("/work");
  return created.id;
}

export async function deleteWorkItem(id: string) {
  const user = await requireManager();
  const [prev] = await db
    .select({ id: schema.workItems.id })
    .from(schema.workItems)
    .where(eq(schema.workItems.id, id))
    .limit(1);
  if (!prev) throw new Error("Work item not found");
  await db
    .update(schema.workItems)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.workItems.id, id));
  await logActivity(user.id, "deleted", id, `${user.name} deleted a work item`);
  broadcast("work_updated", { id });
  revalidatePath("/work");
}

/* ------------------------------------------------------------------ */
/* Board: move card between/within columns                            */
/* ------------------------------------------------------------------ */

export async function moveWorkItem(opts: {
  id: string;
  toStatusId: string;
  position: number;
}) {
  const user = await requireWrite();
  const [prev] = await db
    .select()
    .from(schema.workItems)
    .where(eq(schema.workItems.id, opts.id))
    .limit(1);
  if (!prev) throw new Error("Work item not found");

  const fromStatusId = prev.statusId;
  const [toStatus] = await db
    .select()
    .from(schema.workStatuses)
    .where(eq(schema.workStatuses.id, opts.toStatusId))
    .limit(1);

  const movingToDone = toStatus?.category === "done";
  const completedAt = movingToDone
    ? prev.completedAt ?? new Date()
    : toStatus
      ? null // leaving done clears completion
      : prev.completedAt;

  await db
    .update(schema.workItems)
    .set({
      statusId: opts.toStatusId,
      boardPosition: opts.position,
      completedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.workItems.id, opts.id));

  if (fromStatusId !== opts.toStatusId) {
    await logActivity(
      user.id,
      movingToDone ? "completed" : "moved",
      opts.id,
      `${user.name} moved "${prev.title}" to ${toStatus?.name ?? "a column"}`,
      { fromStatusId, toStatusId: opts.toStatusId },
    );
    // Fire automators for the status change.
    await runStatusChangedAutomators(opts.id, {
      actorId: user.id,
      fromStatusId,
      toStatusId: opts.toStatusId,
    });
  }

  broadcast("work_updated", { id: opts.id });
  revalidatePath("/work");
  return { ok: true };
}

/** Set status directly (e.g. from the detail page header) without reordering. */
export async function setWorkStatus(id: string, statusId: string) {
  await requireWrite();
  const [item] = await db.select().from(schema.workItems).where(eq(schema.workItems.id, id)).limit(1);
  const pos = item?.boardPosition ?? 0;
  return moveWorkItem({ id, toStatusId: statusId, position: pos });
}

export async function markWorkComplete(id: string) {
  const user = await requireWrite();
  const done = await db
    .select()
    .from(schema.workStatuses)
    .where(eq(schema.workStatuses.category, "done"))
    .orderBy(asc(schema.workStatuses.position))
    .limit(1);
  if (done[0]) return moveWorkItem({ id, toStatusId: done[0].id, position: 0 });
  // No "done" status configured: just set completedAt.
  await db
    .update(schema.workItems)
    .set({ completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.workItems.id, id));
  await logActivity(user.id, "completed", id, `${user.name} marked work complete`);
  broadcast("work_updated", { id });
  revalidatePath("/work");
  revalidatePath(`/work/${id}`);
}

/* ------------------------------------------------------------------ */
/* Tasks (checklist)                                                  */
/* ------------------------------------------------------------------ */

export async function addTask(input: {
  workItemId: string;
  title: string;
  section?: string | null;
}) {
  const user = await requireWrite();
  const title = input.title.trim();
  if (!title) throw new Error("Task title required");

  const [{ value: maxPos } = { value: null }] = await db
    .select({ value: max(schema.workTasks.position) })
    .from(schema.workTasks)
    .where(eq(schema.workTasks.workItemId, input.workItemId));

  const [task] = await db
    .insert(schema.workTasks)
    .values({
      workItemId: input.workItemId,
      title,
      section: input.section?.trim() || null,
      position: (maxPos ?? 0) + 1,
    })
    .returning();
  if (!task) throw new Error("Task could not be created.");
  await logActivity(user.id, "updated", input.workItemId, `${user.name} added a task`);
  revalidatePath(`/work/${input.workItemId}`);
  return task;
}

export async function toggleTask(taskId: string, completed: boolean) {
  const user = await requireWrite();
  const [task] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.id, taskId)).limit(1);
  if (!task) throw new Error("Task not found");
  await db
    .update(schema.workTasks)
    .set({
      completed,
      completedAt: completed ? new Date() : null,
      completedById: completed ? user.id : null,
    })
    .where(eq(schema.workTasks.id, taskId));

  // Fire automators for task completion (resilient — never block the toggle).
  if (completed) {
    try {
      await runAutomators("task_completed", {
        actorId: user.id,
        workItemId: task.workItemId,
        taskId,
      });
      // If this was the last open task, fire `all_tasks_done`.
      const [{ value: openCount } = { value: 0 }] = await db
        .select({ value: count() })
        .from(schema.workTasks)
        .where(and(eq(schema.workTasks.workItemId, task.workItemId), eq(schema.workTasks.completed, false)));
      if ((openCount ?? 0) === 0) {
        await runAutomators("all_tasks_done", {
          actorId: user.id,
          workItemId: task.workItemId,
        });
      }
    } catch (err) {
      console.error("[automators] task_completed failed:", err);
    }
  }

  revalidatePath(`/work/${task.workItemId}`);
  return { workItemId: task.workItemId };
}

export async function deleteTask(taskId: string) {
  const user = await requireWrite();
  const [task] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.id, taskId)).limit(1);
  if (!task) return;
  await db.delete(schema.workTasks).where(eq(schema.workTasks.id, taskId));
  await logActivity(user.id, "updated", task.workItemId, `${user.name} deleted a task`);
  revalidatePath(`/work/${task.workItemId}`);
}

export async function reorderTask(taskId: string, direction: "up" | "down") {
  const user = await requireWrite();
  const [task] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.id, taskId)).limit(1);
  if (!task) return;
  const siblings = await db
    .select()
    .from(schema.workTasks)
    .where(eq(schema.workTasks.workItemId, task.workItemId))
    .orderBy(asc(schema.workTasks.position), asc(schema.workTasks.createdAt));

  const idx = siblings.findIndex((t) => t.id === taskId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const a = siblings[idx];
  const b = siblings[swapIdx];
  await db.update(schema.workTasks).set({ position: b.position }).where(eq(schema.workTasks.id, a.id));
  await db.update(schema.workTasks).set({ position: a.position }).where(eq(schema.workTasks.id, b.id));
  await logActivity(user.id, "updated", task.workItemId, `${user.name} reordered a task`);
  revalidatePath(`/work/${task.workItemId}`);
}

/* ------------------------------------------------------------------ */
/* Comments / notes                                                  */
/* ------------------------------------------------------------------ */

export async function addComment(input: { workItemId: string; body: string }) {
  const user = await requireWrite();
  const body = input.body.trim();
  if (!body) throw new Error("Comment cannot be empty");
  const [comment] = await db
    .insert(schema.comments)
    .values({
      entityKind: "work_item",
      entityId: input.workItemId,
      authorId: user.id,
      body,
    })
    .returning();
  if (!comment) throw new Error("Comment could not be created.");
  await logActivity(user.id, "commented", input.workItemId, `${user.name} left a note`);

  // Notify the assignee (if it's someone else) that there's a new note.
  const [item] = await db
    .select()
    .from(schema.workItems)
    .where(eq(schema.workItems.id, input.workItemId))
    .limit(1);
  if (item?.assigneeId && item.assigneeId !== user.id) {
    const [notif] = await db
      .insert(schema.notifications)
      .values({
        userId: item.assigneeId,
        type: "comment",
        title: `${user.name} commented`,
        body,
        entityKind: "work_item",
        entityId: input.workItemId,
      })
      .returning();
    if (notif) emitToUser(item.assigneeId, "notification", notif);
  }

  revalidatePath(`/work/${input.workItemId}`);
  return comment;
}

/* ------------------------------------------------------------------ */
/* Templates → create a work item + tasks                            */
/* ------------------------------------------------------------------ */

export async function applyTemplate(input: {
  templateId: string;
  organizationId?: string | null;
  assigneeId?: string | null;
  startDate?: string | null;
  statusId?: string | null;
}) {
  const user = await requireWrite();
  const [tpl] = await db
    .select()
    .from(schema.workTemplates)
    .where(eq(schema.workTemplates.id, input.templateId))
    .limit(1);
  if (!tpl) throw new Error("Template not found");

  const tasks = await db
    .select()
    .from(schema.templateTasks)
    .where(eq(schema.templateTasks.templateId, input.templateId))
    .orderBy(asc(schema.templateTasks.position));

  const start = toDate(input.startDate) ?? new Date();

  // NOTE: better-sqlite3's db.transaction() callback is synchronous and cannot
  // wrap the async drizzle calls used throughout this codebase. We therefore
  // group the related writes (work item → its template tasks → activity) in a
  // strict, fail-fast order so a failure aborts before later rows are written.
  // Default status = first by position if none provided.
  let statusId = input.statusId || null;
  if (!statusId) {
    const [firstStatus] = await db
      .select()
      .from(schema.workStatuses)
      .orderBy(asc(schema.workStatuses.position))
      .limit(1);
    statusId = firstStatus?.id ?? null;
  }

  const [created] = await db
    .insert(schema.workItems)
    .values({
      title: tpl.name,
      description: tpl.description,
      workTypeId: tpl.workTypeId,
      statusId,
      organizationId: input.organizationId || null,
      assigneeId: input.assigneeId || null,
      startDate: start,
      budgetMinutes: tpl.defaultBudgetMinutes ?? null,
      recurrenceRule: tpl.recurrenceRule ?? null,
      templateId: tpl.id,
    })
    .returning();
  if (!created) throw new Error("Work item could not be created.");

  if (tasks.length) {
    await db.insert(schema.workTasks).values(
      tasks.map((t) => ({
        workItemId: created.id,
        title: t.title,
        section: t.section,
        position: t.position,
        dueDate:
          t.dueOffsetDays != null
            ? new Date(start.getTime() + t.dueOffsetDays * 86400_000)
            : null,
      })),
    );
  }

  await logActivity(
    user.id,
    "created",
    created.id,
    `${user.name} created "${tpl.name}" from a template`,
    { templateId: tpl.id, taskCount: tasks.length },
  );

  if (created.assigneeId) {
    await notifyAssignee({
      assigneeId: created.assigneeId,
      actorName: user.name,
      workItemId: created.id,
      workTitle: created.title,
      verb: "assigned",
    });
  }
  try {
    await runAutomators("work_created", { actorId: user.id, workItemId: created.id });
  } catch (err) {
    console.error("[automators] work_created (template) failed:", err);
  }
  broadcast("work_updated", { id: created.id });
  revalidatePath("/work");
  return created.id;
}
