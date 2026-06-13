import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ClientsList, type ClientRow } from "@/components/clients/clients-list";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const sp = await searchParams;

  const [orgs, users] = await Promise.all([
    db
      .select()
      .from(schema.organizations)
      .where(and(eq(schema.organizations.isClient, true), isNull(schema.organizations.deletedAt)))
      .orderBy(schema.organizations.name),
    db
      .select({ id: schema.users.id, name: schema.users.name, image: schema.users.image, color: schema.users.color })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(schema.users.name),
  ]);

  // Aggregate open work + contact counts grouped by org.
  const [openWorkRows, contactRows] = await Promise.all([
    db
      .select({
        organizationId: schema.workItems.organizationId,
        n: sql<number>`count(*)`,
      })
      .from(schema.workItems)
      .where(and(isNull(schema.workItems.completedAt), isNull(schema.workItems.deletedAt)))
      .groupBy(schema.workItems.organizationId),
    db
      .select({
        organizationId: schema.contacts.organizationId,
        n: sql<number>`count(*)`,
      })
      .from(schema.contacts)
      .where(isNull(schema.contacts.deletedAt))
      .groupBy(schema.contacts.organizationId),
  ]);

  const openWorkMap = new Map(openWorkRows.map((r) => [r.organizationId, Number(r.n)]));
  const contactMap = new Map(contactRows.map((r) => [r.organizationId, Number(r.n)]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  const clients: ClientRow[] = orgs.map((o) => {
    const owner = o.ownerId ? userMap.get(o.ownerId) : undefined;
    return {
      ...o,
      ownerName: owner?.name ?? null,
      ownerImage: owner?.image ?? null,
      ownerColor: owner?.color ?? null,
      openWork: openWorkMap.get(o.id) ?? 0,
      contactCount: contactMap.get(o.id) ?? 0,
    };
  });

  return (
    <ClientsList
      clients={clients}
      users={users.map((u) => ({ id: u.id, name: u.name }))}
      openCreate={sp?.new === "1"}
    />
  );
}
