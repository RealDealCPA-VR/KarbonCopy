import Link from "next/link";
import { desc, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { PeopleSearch } from "@/components/clients/people-search";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const [contacts, orgs] = await Promise.all([
    db
      .select()
      .from(schema.contacts)
      .where(isNull(schema.contacts.deletedAt))
      .orderBy(desc(schema.contacts.isPrimary), schema.contacts.lastName),
    db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations),
  ]);

  const orgMap = new Map(orgs.map((o) => [o.id, o.name]));
  const people = contacts.map((c) => ({
    ...c,
    orgName: c.organizationId ? orgMap.get(c.organizationId) ?? null : null,
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Clients
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">People</h1>
        <p className="text-muted-foreground">
          {people.length} {people.length === 1 ? "contact" : "contacts"} across all clients
        </p>
      </div>

      <PeopleSearch
        people={people.map((p) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          title: p.title,
          email: p.email,
          phone: p.phone,
          isPrimary: p.isPrimary,
          portalEnabled: p.portalEnabled,
          organizationId: p.organizationId,
          orgName: p.orgName,
        }))}
      />
    </div>
  );
}
