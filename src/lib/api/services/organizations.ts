/**
 * Organizations (clients) service — the EXEMPLAR all other services mirror.
 * Pure: explicit actor, RBAC, zod validation, activity logging, plain returns.
 */
import { z } from "zod";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { db, schema, type Actor, requireWrite, requireManager, parse, logActivity, pagination } from "./_base";
import { notFound, validation } from "@/lib/api/errors";
import { encryptField, decryptField, maskTaxId } from "@/lib/crypto";

const { organizations, users } = schema;

async function assertUser(id: string) {
  const [r] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!r) throw validation(`User ${id} not found`);
}

const ENTITY_TYPES = [
  "individual", "sole_prop", "partnership", "s_corp", "c_corp",
  "llc", "nonprofit", "trust", "estate", "other",
] as const;

const createInput = z.object({
  name: z.string().trim().min(1).max(200),
  entityType: z.enum(ENTITY_TYPES).default("c_corp"),
  ein: z.string().trim().max(20).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  fiscalYearEnd: z.string().trim().max(5).optional(), // MM-DD
  notes: z.string().max(5000).optional(),
  ownerId: z.string().optional(),
  isClient: z.boolean().default(true),
});
const updateInput = createInput.partial();

function present(o: typeof organizations.$inferSelect, includeEin: boolean) {
  const einPlain = decryptField(o.ein);
  return {
    id: o.id,
    name: o.name,
    entityType: o.entityType,
    ein: includeEin ? einPlain : einPlain ? maskTaxId(einPlain) : null,
    email: o.email,
    phone: o.phone,
    website: o.website,
    address: o.address,
    fiscalYearEnd: o.fiscalYearEnd,
    notes: o.notes,
    ownerId: o.ownerId,
    isClient: o.isClient,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export async function listOrganizations(actor: Actor, input: unknown = {}) {
  const { limit, offset, search } = parse(pagination, input);
  const where = and(
    isNull(organizations.deletedAt),
    search ? like(organizations.name, `%${search}%`) : undefined,
  );
  const rows = await db
    .select()
    .from(organizations)
    .where(where)
    .orderBy(desc(organizations.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((o) => present(o, false));
}

export async function getOrganization(actor: Actor, id: string) {
  const [o] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!o || o.deletedAt) throw notFound("Organization");
  // cleartext EIN only for manager+
  return present(o, requireCanSeeEin(actor));
}

function requireCanSeeEin(actor: Actor): boolean {
  return actor.role === "manager" || actor.role === "admin" || actor.role === "owner";
}

export async function createOrganization(actor: Actor, input: unknown) {
  requireWrite(actor);
  const data = parse(createInput, input);
  if (data.ownerId) await assertUser(data.ownerId);
  const [row] = await db
    .insert(organizations)
    .values({
      name: data.name,
      entityType: data.entityType,
      ein: data.ein ? encryptField(data.ein) : null,
      email: data.email || null,
      phone: data.phone || null,
      website: data.website || null,
      address: data.address || null,
      fiscalYearEnd: data.fiscalYearEnd || null,
      notes: data.notes || null,
      ownerId: data.ownerId || null,
      isClient: data.isClient,
    })
    .returning();
  if (!row) throw notFound("Organization");
  await logActivity({
    actorId: actor.id,
    verb: "created",
    entityKind: "organization",
    entityId: row.id,
    summary: `${actor.name} created client ${row.name} (via API)`,
  });
  return present(row, requireCanSeeEin(actor));
}

export async function updateOrganization(actor: Actor, id: string, input: unknown) {
  requireWrite(actor);
  const data = parse(updateInput, input);
  const [existing] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!existing || existing.deletedAt) throw notFound("Organization");
  if (data.ownerId) await assertUser(data.ownerId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "entityType", "email", "phone", "website", "address", "fiscalYearEnd", "notes", "ownerId", "isClient"] as const) {
    if (data[k] !== undefined) patch[k] = data[k] === "" ? null : data[k];
  }
  if (data.ein !== undefined) patch.ein = data.ein ? encryptField(data.ein) : null;
  const [row] = await db.update(organizations).set(patch).where(eq(organizations.id, id)).returning();
  if (!row) throw notFound("Organization");
  await logActivity({
    actorId: actor.id, verb: "updated", entityKind: "organization", entityId: id,
    summary: `${actor.name} updated client ${row.name} (via API)`,
  });
  return present(row, requireCanSeeEin(actor));
}

export async function archiveOrganization(actor: Actor, id: string) {
  requireManager(actor);
  const [row] = await db
    .update(organizations)
    .set({ deletedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  if (!row) throw notFound("Organization");
  await logActivity({
    actorId: actor.id, verb: "archived", entityKind: "organization", entityId: id,
    summary: `${actor.name} archived client ${row.name} (via API)`,
  });
  return { id, archived: true };
}
