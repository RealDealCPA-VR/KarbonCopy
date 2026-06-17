"use client";

import * as React from "react";
import Link from "next/link";
import {
  Receipt,
  Plus,
  Search,
  AlertTriangle,
  CircleDollarSign,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "./status-badge";
import { cn, formatMoneyCents } from "@/lib/utils";
import type { InvoiceStatus } from "@/db/schema";

export type InvoiceRow = {
  id: string;
  number: string;
  clientName: string;
  organizationId: string | null;
  status: InvoiceStatus;
  issueDate: number | null;
  dueDate: number | null;
  totalCents: number;
  amountPaidCents: number;
};

export type ClientOption = { id: string; name: string };

const STATUS_FILTERS: { value: InvoiceStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partial" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

function fmtDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function InvoicesList({
  invoices,
  clients,
  stripeOn,
}: {
  invoices: InvoiceRow[];
  clients: ClientOption[];
  stripeOn: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<InvoiceStatus | "all">("all");
  const [clientFilter, setClientFilter] = React.useState<string>("all");

  const kpis = React.useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let outstanding = 0;
    let overdue = 0;
    let paidThisMonth = 0;
    let draftCount = 0;
    for (const inv of invoices) {
      if (inv.status === "void") continue;
      const due = inv.totalCents - inv.amountPaidCents;
      if (inv.status === "draft") draftCount += 1;
      if (inv.status !== "draft" && inv.status !== "paid" && due > 0) outstanding += due;
      if (inv.status === "overdue") overdue += Math.max(0, due);
      // Paid this month: collected amount on invoices whose issue/paid lands this month.
      if (inv.amountPaidCents > 0) {
        const ref = inv.issueDate ?? 0;
        if (ref >= monthStart) paidThisMonth += inv.amountPaidCents;
      }
    }
    return { outstanding, overdue, paidThisMonth, draftCount };
  }, [invoices]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (clientFilter !== "all" && inv.organizationId !== clientFilter) return false;
      if (!q) return true;
      return (
        inv.number.toLowerCase().includes(q) || inv.clientName.toLowerCase().includes(q)
      );
    });
  }, [invoices, query, statusFilter, clientFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <p className="text-muted-foreground">
            {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}
            {!stripeOn && " · online card payments off (set STRIPE_SECRET_KEY)"}
          </p>
        </div>
        <Button asChild>
          <Link href="/billing/new">
            <Plus className="h-4 w-4" /> New invoice
          </Link>
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={CircleDollarSign}
          label="Outstanding"
          value={formatMoneyCents(kpis.outstanding)}
          accent="text-primary"
          bg="bg-primary/10"
        />
        <Kpi
          icon={AlertTriangle}
          label="Overdue"
          value={formatMoneyCents(kpis.overdue)}
          accent={kpis.overdue > 0 ? "text-destructive" : "text-muted-foreground"}
          bg={kpis.overdue > 0 ? "bg-destructive/10" : "bg-muted"}
        />
        <Kpi
          icon={CheckCircle2}
          label="Paid this month"
          value={formatMoneyCents(kpis.paidThisMonth)}
          accent="text-success"
          bg="bg-success/10"
        />
        <Kpi
          icon={FileText}
          label="Drafts"
          value={String(kpis.draftCount)}
          accent="text-muted-foreground"
          bg="bg-muted"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice no. or client…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InvoiceStatus | "all")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasAny={invoices.length > 0} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Issued</th>
                  <th className="px-5 py-3 font-medium">Due</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const balance = inv.totalCents - inv.amountPaidCents;
                  return (
                    <tr
                      key={inv.id}
                      className="border-b last:border-0 transition-colors hover:bg-accent/50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/billing/${inv.id}`}
                          className="font-mono font-medium hover:text-primary"
                        >
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <Link href={`/billing/${inv.id}`} className="hover:text-primary">
                          {inv.clientName}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(inv.issueDate)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(inv.dueDate)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatMoneyCents(inv.totalCents)}
                      </td>
                      <td
                        className={cn(
                          "px-5 py-3 text-right tabular-nums",
                          balance > 0 && inv.status !== "draft" ? "font-medium" : "text-muted-foreground",
                        )}
                      >
                        {inv.status === "paid" || balance <= 0
                          ? formatMoneyCents(0)
                          : formatMoneyCents(balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  accent,
  bg,
}: {
  icon: typeof Receipt;
  label: string;
  value: string;
  accent: string;
  bg: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-lg", bg, accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-bold tabular-nums">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Receipt className="h-7 w-7" />
        </div>
        <div>
          <p className="font-semibold">{hasAny ? "No invoices match your filters" : "No invoices yet"}</p>
          <p className="text-sm text-muted-foreground">
            {hasAny
              ? "Try clearing your search or filters."
              : "Create your first invoice, or generate one from unbilled time."}
          </p>
        </div>
        {!hasAny && (
          <Button asChild className="mt-1">
            <Link href="/billing/new">
              <Plus className="h-4 w-4" /> New invoice
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
