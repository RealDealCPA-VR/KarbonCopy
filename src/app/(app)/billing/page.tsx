import { desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { stripeEnabled } from "@/lib/billing";
import { InvoicesList, type InvoiceRow, type ClientOption } from "@/components/billing/invoices-list";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const [rows, orgs] = await Promise.all([
    db.select().from(schema.invoices).orderBy(desc(schema.invoices.createdAt)).limit(500),
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(schema.organizations.name),
  ]);

  const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

  // Resolve contact-only invoices' client labels.
  const contactIds = Array.from(
    new Set(rows.filter((r) => !r.organizationId && r.contactId).map((r) => r.contactId!)),
  );
  const contactMap = new Map<string, string>();
  if (contactIds.length) {
    const cs = await db
      .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(inArray(schema.contacts.id, contactIds));
    for (const c of cs) contactMap.set(c.id, `${c.firstName} ${c.lastName}`.trim());
  }

  const now = Date.now();
  const invoices: InvoiceRow[] = rows.map((r) => {
    // Surface "overdue" for sent/partial invoices past their due date (display-only;
    // status is also reconciled on the server on the next write).
    const effectiveStatus =
      (r.status === "sent" || r.status === "partial") &&
      r.dueDate &&
      new Date(r.dueDate).getTime() < now &&
      r.amountPaidCents < r.totalCents
        ? "overdue"
        : r.status;
    return {
      id: r.id,
      number: r.number,
      clientName: r.organizationId
        ? orgMap.get(r.organizationId) ?? "Unknown client"
        : r.contactId
          ? contactMap.get(r.contactId) ?? "Unknown contact"
          : "—",
      organizationId: r.organizationId,
      status: effectiveStatus,
      issueDate: r.issueDate ? new Date(r.issueDate).getTime() : null,
      dueDate: r.dueDate ? new Date(r.dueDate).getTime() : null,
      totalCents: r.totalCents,
      amountPaidCents: r.amountPaidCents,
    };
  });

  const clients: ClientOption[] = orgs.map((o) => ({ id: o.id, name: o.name }));

  return <InvoicesList invoices={invoices} clients={clients} stripeOn={stripeEnabled()} />;
}
