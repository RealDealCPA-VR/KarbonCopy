/**
 * Work items + tasks service — mirrors the organizations exemplar.
 * Pure: explicit actor, RBAC, zod validation, activity logging, plain returns.
 */
import { z } from "zod";
import { and, asc, desc, eq, isNull, like } from "drizzle-orm";
import { db, schema, type Actor, requireWrite, parse, logActivity, pagination } from "./_base";
import { notFound, validation } from "@/lib/api/errors";

const { workItems, workTasks, workTypes, workStatuses, organizations, users } = schema;

/** Accept ISO string or epoch ms; coerce to a valid Date. */
const dateCoerce = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const createInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).optional(),
  workTypeId: z.string().trim().min(1).optional(),
  statusId: z.string().trim().min(1).optional(),
  organizationId: z.string().trim().min(1).optional(),
  contactId: z.string().trim().min(1).optional(),
  assigneeId: z.string().trim().min(1).optional(),
  priority: z.enum(PRIORITIES).default("normal"),
  startDate: dateCoerce.optional(),
  dueDate: dateCoerce.optional(),
  budgetMinutes: z.number().int().min(0).optional(),
});
const updateInput = createInput.partial();

const listInput = pagination.extend({
  organizationId: z.string().trim().min(1).optional(),
  assigneeId: z.string().trim().min(1).optional(),
  statusId: z.string().trim().min(1).optional(),
});

const taskCreateInput = z.object({
  title: z.string().trim().min(1).max(300),
  section: z.string().trim().max(120).optional(),
  assigneeId: z.string().trim().min(1).optional(),
  dueDate: dateCoerce.optional(),
});

function present(w: typeof workItems.$inferSelect) {
  return {
    id: w.id,
    title: w.title,
    description: w.description,
    workTypeId: w.workTypeId,
    statusId: w.statusId,
    priority: w.priority,
    organizationId: w.organizationId,
    contactId: w.contactId,
    assigneeId: w.assigneeId,
    teamId: w.teamId,
    startDate: w.startDate,
    dueDate: w.dueDate,
    completedAt: w.completedAt,
    budgetMinutes: w.budgetMinutes,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

function presentTask(t: typeof workTasks.$inferSelect) {
  return {
    id: t.id,
    workItemId: t.workItemId,
    title: t.title,
    section: t.section,
    completed: t.completed,
    completedAt: t.completedAt,
    completedById: t.completedById,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate,
    position: t.position,
    createdAt: t.createdAt,
  };
}

async function assertOrg(id: string) {
  const [r] = await db.select({ id: organizations.id, deletedAt: organizations.deletedAt }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!r || r.deletedAt) throw validation(`Organization ${id} not found`);
}
async function assertUser(id: string) {
  const [r] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!r) throw validation(`User ${id} not found`);
}
async function assertWorkType(id: string) {
  const [r] = await db.select({ id: workTypes.id }).from(workTypes).where(eq(workTypes.id, id)).limit(1);
  if (!r) throw validation(`Work type ${id} not found`);
}
async function assertStatus(id: string) {
  const [r] = await db.select({ id: workStatuses.id }).from(workStatuses).where(eq(workStatuses.id, id)).limit(1);
  if (!r) throw validation(`Work status ${id} not found`);
}

export async function listWorkItems(actor: Actor, input: unknown = {}) {
  const { limit, offset, search, organizationId, assigneeId, statusId } = parse(listInput, input);
  const where = and(
    isNull(workItems.deletedAt),
    organizationId ? eq(workItems.organizationId, organizationId) : undefined,
    assigneeId ? eq(workItems.assigneeId, assigneeId) : undefined,
    statusId ? eq(workItems.statusId, statusId) : undefined,
    search ? like(workItems.title, `%${search}%`) : undefined,
  );
  const rows = await db
    .select()
    .from(workItems)
    .where(where)
    .orderBy(desc(workItems.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(present);
}

export async function getWorkItem(actor: Actor, id: string) {
  const [w] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  if (!w || w.deletedAt) throw notFound("Work item");
  return present(w);
}

export async function createWorkItem(actor: Actor, input: unknown) {
  requireWrite(actor);
  const data = parse(createInput, input);
  if (data.organizationId) await assertOrg(data.organizationId);
  if (data.assigneeId) await assertUser(data.assigneeId);
  if (data.workTypeId) await assertWorkType(data.workTypeId);
  if (data.statusId) await assertStatus(data.statusId);
  const [row] = await db
    .insert(workItems)
    .values({
      title: data.title,
      description: data.description || null,
      workTypeId: data.workTypeId || null,
      statusId: data.statusId || null,
      priority: data.priority,
      organizationId: data.organizationId || null,
      contactId: data.contactId || null,
      assigneeId: data.assigneeId || null,
      startDate: data.startDate ?? null,
      dueDate: data.dueDate ?? null,
      budgetMinutes: data.budgetMinutes ?? null,
    })
    .returning();
  await logActivity({
    actorId: actor.id, verb: "created", entityKind: "work_item", entityId: row.id,
    summary: `${actor.name} created work item ${row.title} (via API)`,
  });
  return present(row);
}

export async function updateWorkItem(actor: Actor, id: string, input: unknown) {
  requireWrite(actor);
  const data = parse(updateInput, input);
  const [existing] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  if (!existing || existing.deletedAt) throw notFound("Work item");
  if (data.organizationId) await assertOrg(data.organizationId);
  if (data.assigneeId) await assertUser(data.assigneeId);
  if (data.workTypeId) await assertWorkType(data.workTypeId);
  if (data.statusId) await assertStatus(data.statusId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["title", "description", "workTypeId", "statusId", "priority", "organizationId", "contactId", "assigneeId", "startDate", "dueDate", "budgetMinutes"] as const) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  const [row] = await db.update(workItems).set(patch).where(eq(workItems.id, id)).returning();
  await logActivity({
    actorId: actor.id, verb: "updated", entityKind: "work_item", entityId: id,
    summary: `${actor.name} updated work item ${row.title} (via API)`,
  });
  return present(row);
}

export async function completeWorkItem(actor: Actor, id: string) {
  requireWrite(actor);
  const [existing] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  if (!existing || existing.deletedAt) throw notFound("Work item");
  const now = new Date();
  const [row] = await db
    .update(workItems)
    .set({ completedAt: now, updatedAt: now })
    .where(eq(workItems.id, id))
    .returning();
  await logActivity({
    actorId: actor.id, verb: "completed", entityKind: "work_item", entityId: id,
    summary: `${actor.name} completed work item ${row.title} (via API)`,
  });
  return present(row);
}

/* ----------------------------- tasks ----------------------------- */

async function assertWorkItem(workItemId: string) {
  const [w] = await db.select({ id: workItems.id, deletedAt: workItems.deletedAt }).from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!w || w.deletedAt) throw notFound("Work item");
}

export async function listTasks(actor: Actor, workItemId: string) {
  await assertWorkItem(workItemId);
  const rows = await db
    .select()
    .from(workTasks)
    .where(eq(workTasks.workItemId, workItemId))
    .orderBy(asc(workTasks.position), asc(workTasks.createdAt));
  return rows.map(presentTask);
}

export async function addTask(actor: Actor, workItemId: string, input: unknown) {
  requireWrite(actor);
  await assertWorkItem(workItemId);
  const data = parse(taskCreateInput, input);
  if (data.assigneeId) await assertUser(data.assigneeId);
  const [row] = await db
    .insert(workTasks)
    .values({
      workItemId,
      title: data.title,
      section: data.section || null,
      assigneeId: data.assigneeId || null,
      dueDate: data.dueDate ?? null,
    })
    .returning();
  await logActivity({
    actorId: actor.id, verb: "created", entityKind: "work_item", entityId: workItemId,
    summary: `${actor.name} added task ${row.title} (via API)`,
  });
  return presentTask(row);
}

export async function toggleTask(actor: Actor, taskId: string, completed: boolean) {
  requireWrite(actor);
  const flag = parse(z.boolean(), completed);
  const [existing] = await db.select().from(workTasks).where(eq(workTasks.id, taskId)).limit(1);
  if (!existing) throw notFound("Task");
  const now = new Date();
  const [row] = await db
    .update(workTasks)
    .set({
      completed: flag,
      completedAt: flag ? now : null,
      completedById: flag ? actor.id : null,
    })
    .where(eq(workTasks.id, taskId))
    .returning();
  await logActivity({
    actorId: actor.id, verb: flag ? "completed" : "reopened", entityKind: "work_item", entityId: row.workItemId,
    summary: `${actor.name} ${flag ? "completed" : "reopened"} task ${row.title} (via API)`,
  });
  return presentTask(row);
}
