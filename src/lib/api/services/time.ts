/**
 * Time entries service — mirrors the organizations exemplar.
 * Pure: explicit actor, RBAC, zod validation, activity logging, plain returns.
 * userId defaults to the acting user.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, schema, type Actor, requireWrite, requireManager, parse, logActivity, pagination } from "./_base";
import { notFound, validation } from "@/lib/api/errors";

const { timeEntries, workItems, users } = schema;

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

const createInput = z.object({
  userId: z.string().trim().min(1).optional(),
  workItemId: z.string().trim().min(1).optional(),
  minutes: z.number().int().min(0),
  date: dateCoerce,
  billable: z.boolean().default(true),
  description: z.string().max(2000).optional(),
  rateCents: z.number().int().min(0).optional(),
});
const updateInput = z.object({
  workItemId: z.string().trim().min(1).nullable().optional(),
  minutes: z.number().int().min(0).optional(),
  date: dateCoerce.optional(),
  billable: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
  rateCents: z.number().int().min(0).nullable().optional(),
});

const listInput = pagination.extend({
  userId: z.string().trim().min(1).optional(),
  workItemId: z.string().trim().min(1).optional(),
});

function present(t: typeof timeEntries.$inferSelect) {
  return {
    id: t.id,
    userId: t.userId,
    workItemId: t.workItemId,
    organizationId: t.organizationId,
    description: t.description,
    minutes: t.minutes,
    billable: t.billable,
    rateCents: t.rateCents,
    date: t.date,
    createdAt: t.createdAt,
  };
}

async function assertWorkItem(id: string): Promise<string | null> {
  const [w] = await db
    .select({ id: workItems.id, organizationId: workItems.organizationId, deletedAt: workItems.deletedAt })
    .from(workItems)
    .where(eq(workItems.id, id))
    .limit(1);
  if (!w || w.deletedAt) throw validation(`Work item ${id} not found`);
  return w.organizationId;
}
async function assertUser(id: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw validation(`User ${id} not found`);
}

export async function listTimeEntries(actor: Actor, input: unknown = {}) {
  const { limit, offset, userId, workItemId } = parse(listInput, input);
  const where = and(
    userId ? eq(timeEntries.userId, userId) : undefined,
    workItemId ? eq(timeEntries.workItemId, workItemId) : undefined,
  );
  const rows = await db
    .select()
    .from(timeEntries)
    .where(where)
    .orderBy(desc(timeEntries.date), desc(timeEntries.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(present);
}

export async function createTimeEntry(actor: Actor, input: unknown) {
  requireWrite(actor);
  const data = parse(createInput, input);
  const userId = data.userId ?? actor.id;
  if (data.userId && data.userId !== actor.id) await assertUser(data.userId);
  let organizationId: string | null = null;
  if (data.workItemId) organizationId = await assertWorkItem(data.workItemId);
  const [row] = await db
    .insert(timeEntries)
    .values({
      userId,
      workItemId: data.workItemId || null,
      organizationId,
      minutes: data.minutes,
      date: data.date,
      billable: data.billable,
      description: data.description || null,
      rateCents: data.rateCents ?? null,
    })
    .returning();
  if (!row) throw notFound("Time entry");
  await logActivity({
    actorId: actor.id, verb: "created", entityKind: "time_entry", entityId: row.id,
    summary: `${actor.name} logged ${row.minutes} min (via API)`,
  });
  return present(row);
}

export async function updateTimeEntry(actor: Actor, id: string, input: unknown) {
  requireWrite(actor);
  const data = parse(updateInput, input);
  const [existing] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  if (!existing) throw notFound("Time entry");
  const patch: Record<string, unknown> = {};
  if (data.workItemId !== undefined) {
    if (data.workItemId === null) {
      patch.workItemId = null;
    } else {
      patch.organizationId = await assertWorkItem(data.workItemId);
      patch.workItemId = data.workItemId;
    }
  }
  for (const k of ["minutes", "date", "billable", "description", "rateCents"] as const) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  const [row] = await db.update(timeEntries).set(patch).where(eq(timeEntries.id, id)).returning();
  if (!row) throw notFound("Time entry");
  await logActivity({
    actorId: actor.id, verb: "updated", entityKind: "time_entry", entityId: id,
    summary: `${actor.name} updated a time entry (via API)`,
  });
  return present(row);
}

export async function deleteTimeEntry(actor: Actor, id: string) {
  requireManager(actor);
  const [existing] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  if (!existing) throw notFound("Time entry");
  await db.delete(timeEntries).where(eq(timeEntries.id, id));
  await logActivity({
    actorId: actor.id, verb: "deleted", entityKind: "time_entry", entityId: id,
    summary: `${actor.name} deleted a time entry (via API)`,
  });
  return { id, deleted: true as const };
}
