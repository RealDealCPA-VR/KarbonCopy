"use client";

import * as React from "react";
import { Target, AlertTriangle, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatMinutes, formatMoneyCents } from "@/lib/utils";
import type { BudgetRow } from "./types";

type Filter = "all" | "over" | "active";

export function BudgetsTab({
  budgets,
  clients,
  assignees,
}: {
  budgets: BudgetRow[];
  clients: { id: string; name: string }[];
  assignees: { id: string; name: string }[];
}) {
  const [query, setQuery] = React.useState("");
  const [clientId, setClientId] = React.useState("all");
  const [assigneeId, setAssigneeId] = React.useState("all");
  const [status, setStatus] = React.useState<Filter>("all");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return budgets.filter((b) => {
      if (clientId !== "all" && b.organizationId !== clientId) return false;
      if (assigneeId !== "all") {
        if (assigneeId === "none" ? b.assigneeId != null : b.assigneeId !== assigneeId) return false;
      }
      if (status === "over" && !isOver(b)) return false;
      if (status === "active" && b.completed) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        (b.clientName ?? "").toLowerCase().includes(q) ||
        (b.assigneeName ?? "").toLowerCase().includes(q)
      );
    });
  }, [budgets, query, clientId, assigneeId, status]);

  const summary = React.useMemo(() => {
    const overCount = budgets.filter(isOver).length;
    const totalBudget = budgets.reduce((s, b) => s + (b.budgetAmountCents ?? 0), 0);
    const totalActual = budgets.reduce((s, b) => s + b.billableAmountCents, 0);
    return { overCount, totalBudget, totalActual, count: budgets.length };
  }, [budgets]);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Budgeted engagements" value={String(summary.count)} icon={Target} />
        <SummaryCard
          label="Over budget"
          value={String(summary.overCount)}
          icon={AlertTriangle}
          tone={summary.overCount > 0 ? "destructive" : "default"}
        />
        <SummaryCard
          label="Billable vs budget"
          value={`${formatMoneyCents(summary.totalActual)} / ${formatMoneyCents(summary.totalBudget)}`}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search engagements…"
            className="pl-9"
          />
        </div>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-[180px]">
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
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
            {assignees.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as Filter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="over">Over budget</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasAny={budgets.length > 0} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Engagement</th>
                    <th className="px-5 py-3 font-medium">Time used</th>
                    <th className="px-5 py-3 font-medium">Cost vs budget</th>
                    <th className="px-5 py-3 text-right font-medium">Realization</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => (
                    <BudgetRowView key={b.id} b={b} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BudgetRowView({ b }: { b: BudgetRow }) {
  const timePct = pct(b.actualMinutes, b.budgetMinutes);
  const costPct = pct(b.billableAmountCents, b.budgetAmountCents);
  const over = isOver(b);
  // Realization = billable amount earned / budgeted amount.
  const realization =
    b.budgetAmountCents && b.budgetAmountCents > 0
      ? Math.round((b.billableAmountCents / b.budgetAmountCents) * 100)
      : null;

  return (
    <tr className="border-b last:border-0 align-top transition-colors hover:bg-accent/40">
      <td className="px-5 py-4">
        <div className="font-medium">{b.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{b.clientName ?? "No client"}</span>
          {b.assigneeName && <span>· {b.assigneeName}</span>}
          {b.completed && <Badge variant="secondary">Done</Badge>}
          {over && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Over
            </Badge>
          )}
        </div>
      </td>
      <td className="w-[220px] px-5 py-4">
        <MeterCell
          pctValue={timePct}
          left={formatMinutes(b.actualMinutes)}
          right={b.budgetMinutes ? formatMinutes(b.budgetMinutes) : "—"}
        />
      </td>
      <td className="w-[220px] px-5 py-4">
        <MeterCell
          pctValue={costPct}
          left={formatMoneyCents(b.billableAmountCents)}
          right={b.budgetAmountCents ? formatMoneyCents(b.budgetAmountCents) : "—"}
        />
      </td>
      <td className="px-5 py-4 text-right">
        {realization == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              "text-base font-bold tabular-nums",
              realization > 100 ? "text-success" : realization < 70 ? "text-warning" : "",
            )}
          >
            {realization}%
          </span>
        )}
      </td>
    </tr>
  );
}

/** A labelled progress meter. */
function MeterCell({
  pctValue,
  left,
  right,
}: {
  pctValue: number | null;
  left: string;
  right: string;
}) {
  const over = pctValue != null && pctValue > 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className={cn("font-medium tabular-nums", over && "text-destructive")}>{left}</span>
        <span className="text-muted-foreground tabular-nums">{right}</span>
      </div>
      <Progress
        value={pctValue == null ? 0 : Math.min(100, pctValue)}
        className={cn(over && "bg-destructive/20")}
        indicatorClassName={cn(
          over
            ? "bg-destructive"
            : pctValue != null && pctValue > 85
              ? "bg-warning"
              : "bg-primary",
        )}
      />
      <div className="text-right text-[11px] tabular-nums text-muted-foreground">
        {pctValue == null ? "No budget" : `${pctValue}%`}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "destructive";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        {Icon && (
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-lg",
              tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <div className={cn("truncate text-xl font-bold tabular-nums", tone === "destructive" && "text-destructive")}>
            {value}
          </div>
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
          <Target className="h-7 w-7" />
        </div>
        <div>
          <p className="font-semibold">
            {hasAny ? "No engagements match your filters" : "No budgets set yet"}
          </p>
          <p className="text-sm text-muted-foreground">
            {hasAny
              ? "Try clearing your search or filters."
              : "Set a budget on a work item to track it against actual time and cost."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function pct(actual: number, budget: number | null): number | null {
  if (!budget || budget <= 0) return null;
  return Math.round((actual / budget) * 100);
}

function isOver(b: BudgetRow): boolean {
  const t = pct(b.actualMinutes, b.budgetMinutes);
  const c = pct(b.billableAmountCents, b.budgetAmountCents);
  return (t != null && t > 100) || (c != null && c > 100);
}
