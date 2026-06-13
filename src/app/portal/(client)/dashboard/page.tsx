import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  FileBox,
  Receipt,
  ClipboardList,
  ArrowRight,
  UploadCloud,
  CheckCircle2,
  Download,
} from "lucide-react";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { PortalHeader } from "@/components/portal-client/portal-header";
import { guardPortal } from "../_guard";
import { formatMoneyCents } from "@/lib/utils";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const OPEN_INVOICE_STATUSES = ["sent", "partial", "overdue"] as const;

export default async function PortalDashboardPage() {
  const { contact, organization } = await guardPortal();
  const orgId = organization?.id;
  const greetName = contact.firstName || contact.lastName || "there";

  // No org → nothing scoped to show. Render an empty, safe state.
  if (!orgId) {
    return (
      <div className="min-h-screen">
        <PortalHeader
          firmName={organization?.name}
          clientName={`${contact.firstName} ${contact.lastName}`.trim()}
          active="dashboard"
        />
        <main className="mx-auto max-w-5xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Welcome, {greetName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account isn&apos;t linked to any documents or invoices yet. Please contact your
            accountant if you expected to see something here.
          </p>
        </main>
      </div>
    );
  }

  const [openRequests, recentDocs, openInvoices] = await Promise.all([
    db
      .select()
      .from(schema.documentRequests)
      .where(
        and(
          eq(schema.documentRequests.organizationId, orgId),
          inArray(schema.documentRequests.status, ["open", "partial"]),
        ),
      )
      .orderBy(desc(schema.documentRequests.createdAt))
      .limit(10),
    db
      .select({
        id: schema.documents.id,
        name: schema.documents.name,
        mimeType: schema.documents.mimeType,
        sizeBytes: schema.documents.sizeBytes,
        createdAt: schema.documents.createdAt,
        storagePath: schema.documents.storagePath,
      })
      .from(schema.documents)
      .where(eq(schema.documents.organizationId, orgId))
      .orderBy(desc(schema.documents.createdAt))
      .limit(5),
    db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.organizationId, orgId),
          inArray(schema.invoices.status, [...OPEN_INVOICE_STATUSES]),
        ),
      )
      .orderBy(desc(schema.invoices.issueDate)),
  ]);

  const balanceDueCents = openInvoices.reduce(
    (sum, inv) => sum + Math.max(0, inv.totalCents - inv.amountPaidCents),
    0,
  );

  return (
    <div className="min-h-screen">
      <PortalHeader
        firmName={organization?.name}
        clientName={`${contact.firstName} ${contact.lastName}`.trim()}
        active="dashboard"
      />

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:py-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome, {greetName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what your accountant needs and what&apos;s available to you.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            icon={ClipboardList}
            label="Open requests"
            value={String(openRequests.length)}
            href="#requests"
          />
          <SummaryCard
            icon={FileBox}
            label="Your documents"
            value={String(recentDocs.length)}
            href="/portal/documents"
          />
          <SummaryCard
            icon={Receipt}
            label="Balance due"
            value={formatMoneyCents(balanceDueCents)}
            href="/portal/invoices"
            emphasize={balanceDueCents > 0}
          />
        </div>

        {/* Open document requests */}
        <section id="requests" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Document requests</h2>
          </div>

          {openRequests.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="You're all caught up"
              body="There are no open document requests right now."
            />
          ) : (
            <div className="space-y-3">
              {openRequests.map((req) => {
                const items = Array.isArray(req.items) ? req.items : [];
                const done = items.filter((i) => i.fulfilled).length;
                return (
                  <div
                    key={req.id}
                    className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{req.title}</p>
                        {req.message && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {req.message}
                          </p>
                        )}
                        {items.length > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {done} of {items.length} items uploaded
                          </p>
                        )}
                      </div>
                      <Button asChild size="sm">
                        <Link href={`/portal/${req.magicToken}`}>
                          <UploadCloud className="h-4 w-4" /> Upload
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent documents */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent documents</h2>
            {recentDocs.length > 0 && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/portal/documents">
                  View all <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>

          {recentDocs.length === 0 ? (
            <EmptyState
              icon={FileBox}
              title="No documents yet"
              body="Documents your firm shares with you will appear here."
            />
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {recentDocs.map((doc) => {
                const downloadable = !isUncPath(doc.storagePath);
                return (
                  <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                    <FileBox className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.createdAt ? format(doc.createdAt, "MMM d, yyyy") : ""}
                      </p>
                    </div>
                    {downloadable && (
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/api/portal/documents/${doc.id}`}>
                          <Download className="h-4 w-4" /> Download
                        </a>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Open invoices preview */}
        {openInvoices.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Outstanding invoices</h2>
              <Button asChild variant="ghost" size="sm">
                <Link href="/portal/invoices">
                  View all <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="divide-y rounded-xl border bg-card">
              {openInvoices.slice(0, 3).map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <Receipt className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{inv.number}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.dueDate ? `Due ${format(inv.dueDate, "MMM d, yyyy")}` : "No due date"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoneyCents(Math.max(0, inv.totalCents - inv.amountPaidCents))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function isUncPath(p: string): boolean {
  return p.includes(":") || p.startsWith("\\\\");
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  href,
  emphasize,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href: string;
  emphasize?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <p
        className={
          "mt-2 text-2xl font-bold tabular-nums " + (emphasize ? "text-destructive" : "")
        }
      >
        {value}
      </p>
    </Link>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/50 p-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
