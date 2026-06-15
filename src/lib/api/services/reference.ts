/**
 * Reference data service — read-only lookups for resolving ids.
 * Any actor may read. No mutations, no RBAC floor beyond authentication.
 */
import { asc } from "drizzle-orm";
import { db, schema, type Actor } from "./_base";

const { workTypes, workStatuses, users, tags } = schema;

export async function listWorkTypes(actor: Actor) {
  const rows = await db.select().from(workTypes).orderBy(asc(workTypes.name));
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    color: w.color,
    defaultBudgetMinutes: w.defaultBudgetMinutes,
  }));
}

export async function listWorkStatuses(actor: Actor) {
  const rows = await db.select().from(workStatuses).orderBy(asc(workStatuses.position));
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    position: s.position,
    color: s.color,
    isDefault: s.isDefault,
  }));
}

export async function listUsers(actor: Actor) {
  const rows = await db.select().from(users).orderBy(asc(users.name));
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
  }));
}

export async function listTags(actor: Actor) {
  const rows = await db.select().from(tags).orderBy(asc(tags.name));
  return rows.map((t) => ({ id: t.id, name: t.name, color: t.color }));
}
