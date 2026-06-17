/**
 * Compliance deadlines service — mirrors the organizations exemplar.
 * Pure: explicit actor, RBAC, zod validation, activity logging, plain returns.
 */
import { z } from "zod";
import { and, asc, eq, like } from "drizzle-orm";
import { db, schema, type Actor, requireWrite, requireManager, parse, logActivity, pagination } from "./_base";
import { notFound, validation } from "@/lib/api/errors";

const { complianceDeadlines, organizations } = schema;

const DEADLINE_STATUSES = ["upcoming", "in_progress", "filed", "extended", "missed", "na"] as const;

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
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  dueDate: dateCoerce,
  form: z.string().trim().max(40).optional(),
  jurisdiction: z.string().trim().max(40).optional(),
  taxPeriod: z.string().trim().max(40).optional(),
});
const updateInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  dueDate: dateCoerce.optional(),
  form: z.string().trim().max(40).nullable().optional(),
  jurisdiction: z.string().trim().max(40).optional(),
  taxPeriod: z.string().trim().max(40).nullable().optional(),
  status: z.enum(DEADLINE_STATUSES).optional(),
});

const listInput = pagination.extend({
  organizationId: z.string().trim().min(1).optional(),
  status: z.enum(DEADLINE_STATUSES).optional(),
});

function present(d: typeof complianceDeadlines.$inferSelect) {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    jurisdiction: d.jurisdiction,
    form: d.form,
    taxPeriod: d.taxPeriod,
    dueDate: d.dueDate,
    extendedDueDate: d.extendedDueDate,
    status: d.status,
    workItemId: d.workItemId,
    createdAt: d.createdAt,
  };
}

async function assertOrg(id: string) {
  const [r] = await db.select({ id: organizations.id, deletedAt: organizations.deletedAt }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!r || r.deletedAt) throw validation(`Organization ${id} not found`);
}

export async function listDeadlines(actor: Actor, input: unknown = {}) {
  const { limit, offset, search, organizationId, status } = parse(listInput, input);
  const where = and(
    organizationId ? eq(complianceDeadlines.organizationId, organizationId) : undefined,
    status ? eq(complianceDeadlines.status, status) : undefined,
    search ? like(complianceDeadlines.name, `%${search}%`) : undefined,
  );
  const rows = await db
    .select()
    .from(complianceDeadlines)
    .where(where)
    .orderBy(asc(complianceDeadlines.dueDate))
    .limit(limit)
    .offset(offset);
  return rows.map(present);
}

export async function getDeadline(actor: Actor, id: string) {
  const [d] = await db.select().from(complianceDeadlines).where(eq(complianceDeadlines.id, id)).limit(1);
  if (!d) throw notFound("Deadline");
  return present(d);
}

export async function createDeadline(actor: Actor, input: unknown) {
  requireWrite(actor);
  const data = parse(createInput, input);
  await assertOrg(data.organizationId);
  const [row] = await db
    .insert(complianceDeadlines)
    .values({
      organizationId: data.organizationId,
      name: data.name,
      dueDate: data.dueDate,
      form: data.form || null,
      jurisdiction: data.jurisdiction || "federal",
      taxPeriod: data.taxPeriod || null,
    })
    .returning();
  if (!row) throw notFound("Deadline");
  await logActivity({
    actorId: actor.id, verb: "created", entityKind: "deadline", entityId: row.id,
    summary: `${actor.name} created deadline ${row.name} (via API)`,
  });
  return present(row);
}

export async function updateDeadline(actor: Actor, id: string, input: unknown) {
  requireWrite(actor);
  const data = parse(updateInput, input);
  const [existing] = await db.select().from(complianceDeadlines).where(eq(complianceDeadlines.id, id)).limit(1);
  if (!existing) throw notFound("Deadline");
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "dueDate", "form", "jurisdiction", "taxPeriod", "status"] as const) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  const [row] = await db.update(complianceDeadlines).set(patch).where(eq(complianceDeadlines.id, id)).returning();
  if (!row) throw notFound("Deadline");
  await logActivity({
    actorId: actor.id, verb: "updated", entityKind: "deadline", entityId: id,
    summary: `${actor.name} updated deadline ${row.name} (via API)`,
  });
  return present(row);
}

export async function setDeadlineStatus(actor: Actor, id: string, status: unknown) {
  requireWrite(actor);
  const value = parse(z.enum(DEADLINE_STATUSES), status);
  const [existing] = await db.select().from(complianceDeadlines).where(eq(complianceDeadlines.id, id)).limit(1);
  if (!existing) throw notFound("Deadline");
  const [row] = await db
    .update(complianceDeadlines)
    .set({ status: value })
    .where(eq(complianceDeadlines.id, id))
    .returning();
  if (!row) throw notFound("Deadline");
  await logActivity({
    actorId: actor.id, verb: "updated", entityKind: "deadline", entityId: id,
    summary: `${actor.name} set deadline ${row.name} status to ${value} (via API)`,
  });
  return present(row);
}
