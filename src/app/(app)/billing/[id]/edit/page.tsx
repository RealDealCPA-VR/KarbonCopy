import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { deriveTaxBps } from "@/lib/billing";
import { InvoiceEditor, type EditorClient, type EditorInvoice } from "@/components/billing/invoice-editor";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();

  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  if (!inv) notFound();
  // Paid/void invoices are immutable — bounce back to the detail page.
  if (inv.status === "paid" || inv.status === "void") redirect(`/billing/${id}`);

  const [lines, orgs] = await Promise.all([
    db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, id))
      .orderBy(asc(schema.invoiceLines.position)),
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(schema.organizations.name),
  ]);

  const clients: EditorClient[] = orgs.map((o) => ({ id: o.id, name: o.name }));

  const editorInvoice: EditorInvoice = {
    id: inv.id,
    organizationId: inv.organizationId,
    issueDate: toDateInput(inv.issueDate),
    dueDate: toDateInput(inv.dueDate),
    notes: inv.notes,
    terms: inv.terms,
    taxBps: deriveTaxBps(inv),
    discountCents: inv.discountCents,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitCents: l.unitCents,
      workItemId: l.workItemId,
      timeEntryIds: l.timeEntryIds ?? null,
    })),
  };

  return (
    <div className="space-y-6">
      <Link
        href={`/billing/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Invoice {inv.number}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit {inv.number}</h1>
        <p className="text-muted-foreground">Adjust line items, totals, and details.</p>
      </div>
      <InvoiceEditor clients={clients} invoice={editorInvoice} />
    </div>
  );
}
