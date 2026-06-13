import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, Building2, CalendarDays } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { db, schema } from "@/db";
import { requireUser, hasRole } from "@/lib/auth";
import { stripeEnabled } from "@/lib/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoneyCents } from "@/lib/utils";
import { StatusBadge } from "@/components/billing/status-badge";
import { InvoiceActions } from "@/components/billing/invoice-actions";
import { PaymentDialog } from "@/components/billing/payment-dialog";
import type { Activity } from "@/db/schema";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const METHOD_LABEL: Record<string, string> = {
  card: "Card",
  ach: "ACH",
  check: "Check",
  cash: "Cash",
  wire: "Wire",
  manual: "Manual",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  if (!inv) notFound();

  const [lines, paymentRows] = await Promise.all([
    db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, id))
      .orderBy(asc(schema.invoiceLines.position)),
    db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.invoiceId, id))
      .orderBy(desc(schema.payments.receivedAt)),
  ]);

  let clientName = "—";
  let orgHref: string | null = null;
  if (inv.organizationId) {
    const [org] = await db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, inv.organizationId))
      .limit(1);
    clientName = org?.name ?? "Unknown client";
    orgHref = `/clients/${inv.organizationId}`;
  } else if (inv.contactId) {
    const [c] = await db
      .select({ firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, inv.contactId))
      .limit(1);
    clientName = c ? `${c.firstName} ${c.lastName}`.trim() : "Unknown contact";
  }

  const activityRows: Activity[] = await db
    .select()
    .from(schema.activities)
    .where(and(eq(schema.activities.entityKind, "invoice"), eq(schema.activities.entityId, id)))
    .orderBy(desc(schema.activities.createdAt))
    .limit(40);

  const balance = Math.max(0, inv.totalCents - inv.amountPaidCents);
  const isManager = hasRole(user, "manager");
  const editable = inv.status !== "paid" && inv.status !== "void";

  return (
    <div className="space-y-6">
      <Link
        href="/billing"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Billing
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight">{inv.number}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {orgHref ? (
                <Link href={orgHref} className="hover:text-primary">
                  {clientName}
                </Link>
              ) : (
                clientName
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" /> Issued {fmtDate(inv.issueDate)}
            </span>
            <span>Due {fmtDate(inv.dueDate)}</span>
          </div>
        </div>
        <InvoiceActions
          invoiceId={inv.id}
          status={inv.status}
          editable={editable}
          isManager={isManager}
          stripeOn={stripeEnabled()}
          balanceCents={balance}
          hasPayments={paymentRows.length > 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Line items + payments */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Description</th>
                    <th className="px-5 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-5 py-2.5 text-right font-medium">Unit</th>
                    <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-5 py-3">{l.description}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {l.quantity}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {formatMoneyCents(l.unitCents)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatMoneyCents(l.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-1.5 border-t px-5 py-4">
                <Row label="Subtotal" value={formatMoneyCents(inv.subtotalCents)} />
                {inv.discountCents > 0 && (
                  <Row label="Discount" value={`− ${formatMoneyCents(inv.discountCents)}`} />
                )}
                {inv.taxCents > 0 && <Row label="Tax" value={formatMoneyCents(inv.taxCents)} />}
                <Separator className="my-2" />
                <Row label="Total" value={formatMoneyCents(inv.totalCents)} bold />
                {inv.amountPaidCents > 0 && (
                  <Row label="Paid" value={`− ${formatMoneyCents(inv.amountPaidCents)}`} />
                )}
                <Row label="Balance due" value={formatMoneyCents(balance)} bold />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Payments</CardTitle>
              {editable && inv.status !== "void" && (
                <PaymentDialog invoiceId={inv.id} balanceCents={balance} />
              )}
            </CardHeader>
            <CardContent className="p-0">
              {paymentRows.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No payments recorded yet.
                </p>
              ) : (
                <div className="divide-y">
                  {paymentRows.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <div className="text-sm font-medium">
                          {formatMoneyCents(p.amountCents)}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {METHOD_LABEL[p.method] ?? p.method}
                            {p.processor === "stripe" ? " · Stripe" : ""}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(p.receivedAt)}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Balance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-bold tabular-nums">{formatMoneyCents(balance)}</div>
              <div className="text-sm text-muted-foreground">
                of {formatMoneyCents(inv.totalCents)} total
              </div>
              {inv.terms && (
                <>
                  <Separator />
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Terms
                    </div>
                    <div className="mt-0.5 text-sm">{inv.terms}</div>
                  </div>
                </>
              )}
              {inv.notes && (
                <>
                  <Separator />
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Notes
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{inv.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activityRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {activityRows.map((a) => (
                    <div key={a.id} className="text-sm">
                      <p>{a.summary}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={bold ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={bold ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}
