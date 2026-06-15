/**
 * Cross-entity search service. Read-only; any actor.
 * Pure: explicit actor, zod validation, plain returns.
 */
import { z } from "zod";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import { db, schema, type Actor, parse } from "./_base";

const { organizations, contacts, workItems, invoices } = schema;

const optsInput = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function search(actor: Actor, query: unknown, opts: unknown = {}) {
  const q = parse(z.string().trim().min(1).max(200), query);
  const { limit } = parse(optsInput, opts);
  const term = `%${q}%`;

  const [orgRows, contactRows, workRows, invoiceRows] = await Promise.all([
    db
      .select()
      .from(organizations)
      .where(and(isNull(organizations.deletedAt), like(organizations.name, term)))
      .orderBy(desc(organizations.createdAt))
      .limit(limit),
    db
      .select()
      .from(contacts)
      .where(
        and(
          isNull(contacts.deletedAt),
          or(
            like(contacts.firstName, term),
            like(contacts.lastName, term),
            like(contacts.email, term),
          ),
        ),
      )
      .orderBy(desc(contacts.createdAt))
      .limit(limit),
    db
      .select()
      .from(workItems)
      .where(and(isNull(workItems.deletedAt), like(workItems.title, term)))
      .orderBy(desc(workItems.createdAt))
      .limit(limit),
    db
      .select()
      .from(invoices)
      .where(like(invoices.number, term))
      .orderBy(desc(invoices.createdAt))
      .limit(limit),
  ]);

  return {
    organizations: orgRows.map((o) => ({
      id: o.id,
      name: o.name,
      entityType: o.entityType,
      email: o.email,
    })),
    contacts: contactRows.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      organizationId: c.organizationId,
    })),
    workItems: workRows.map((w) => ({
      id: w.id,
      title: w.title,
      statusId: w.statusId,
      organizationId: w.organizationId,
    })),
    invoices: invoiceRows.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      totalCents: i.totalCents,
      organizationId: i.organizationId,
    })),
  };
}
