import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { InvoiceEditor, type EditorClient } from "@/components/billing/invoice-editor";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;

  const orgs = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizations)
    .where(isNull(schema.organizations.deletedAt))
    .orderBy(schema.organizations.name);

  const clients: EditorClient[] = orgs.map((o) => ({ id: o.id, name: o.name }));

  return (
    <div className="space-y-6">
      <Link
        href="/billing"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Billing
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New invoice</h1>
        <p className="text-muted-foreground">
          Pick a client, add line items, or pull in unbilled time.
        </p>
      </div>
      <InvoiceEditor clients={clients} defaultOrgId={sp?.org ?? null} />
    </div>
  );
}
