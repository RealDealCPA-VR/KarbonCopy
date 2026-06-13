import { desc, eq } from "drizzle-orm";
import { Receipt, CreditCard } from "lucide-react";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PortalHeader } from "@/components/portal-client/portal-header";
import { guardPortal } from "../_guard";
import { formatMoneyCents } from "@/lib/utils";
import { format } from "date-fns";
import type { InvoiceStatus } from "@/db/schema";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Due",
  partial: "Partially paid",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

function statusVariant(s: InvoiceStatus): "default" | "secondary" | "success" | "warning" | "destructive" | "outline" {
  switch (s) {
    case "paid":
      return "success";
    case "overdue":
      return "destructive";
    case "partial":
      return "warning";
    case "sent":
      return "default";
    default:
      return "secondary";
  }
}

export default async function PortalInvoicesPage() {
  const { contact, organization } = await guardPortal();
  const orgId = organization?.id;

  // Never surface drafts to clients; show everything else for their org.
  const invoices = orgId
    ? (
        await db
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.organizationId, orgId))
          .orderBy(desc(schema.invoices.issueDate))
      ).filter((inv) => inv.status !== "draft")
    : [];

  const balanceDueCents = invoices.reduce((sum, inv) => {
    if (inv.status === "paid" || inv.status === "void") return sum;
    return sum + Math.max(0, inv.totalCents - inv.amountPaidCents);
  }, 0);

  return (
    <div className="min-h-screen">
      <PortalHeader
        firmName={organization?.name}
        clientName={`${contact.firstName} ${contact.lastName}`.trim()}
        active="invoices"
      />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              View and pay your invoices securely.
            </p>
          </div>
          {balanceDueCents > 0 && (
            <div className="rounded-xl border bg-card px-4 py-2 text-right">
              <p className="text-xs text-muted-foreground">Balance due</p>
              <p className="text-xl font-bold tabular-nums text-destructive">
                {formatMoneyCents(balanceDueCents)}
              </p>
            </div>
          )}
        </div>

        {invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/50 p-12 text-center">
            <Receipt className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No invoices</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              You don&apos;t have any invoices yet. They&apos;ll appear here when your firm issues
              one.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map((inv) => {
              const remaining = Math.max(0, inv.totalCents - inv.amountPaidCents);
              const payable =
                remaining > 0 &&
                (inv.status === "sent" || inv.status === "partial" || inv.status === "overdue") &&
                !!inv.payToken;
              return (
                <div
                  key={inv.id}
                  className="rounded-xl border bg-card p-4 sm:flex sm:items-center sm:gap-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <div className="mt-3 min-w-0 flex-1 sm:mt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{inv.number}</p>
                      <Badge variant={statusVariant(inv.status)}>
                        {STATUS_LABEL[inv.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {inv.issueDate ? `Issued ${format(inv.issueDate, "MMM d, yyyy")}` : ""}
                      {inv.dueDate ? ` · Due ${format(inv.dueDate, "MMM d, yyyy")}` : ""}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-4 sm:mt-0 sm:block sm:text-right">
                    <div>
                      <p className="font-semibold tabular-nums">
                        {formatMoneyCents(inv.totalCents)}
                      </p>
                      {inv.amountPaidCents > 0 && inv.status !== "paid" && (
                        <p className="text-xs text-muted-foreground">
                          {formatMoneyCents(remaining)} remaining
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 sm:mt-0 sm:ml-4">
                    {payable ? (
                      <Button asChild size="sm" className="w-full sm:w-auto">
                        <a href={`/portal/pay/${inv.payToken}`}>
                          <CreditCard className="h-4 w-4" /> Pay {formatMoneyCents(remaining)}
                        </a>
                      </Button>
                    ) : inv.status === "paid" ? (
                      <span className="text-sm font-medium text-success">Paid</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Payments are processed securely. Card details never touch your accountant&apos;s systems.
        </p>
      </main>
    </div>
  );
}
